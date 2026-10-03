// OLE file-drop target for the island webview.
//
// wry registers IDropTarget once at webview creation by walking child HWNDs.
// Under `tauri dev` (and after WebView2 recreates Chrome_RenderWidgetHostHWND),
// that registration often lands on a dead/wrong HWND while WebView2's own
// target on the live render widget refuses drops (no HTML5 handler) — the OS
// "no drop" cursor, zero `tauri://drag-*` events.
//
// We re-register our own target on every child that can accept OLE drops and
// emit `file-drag` to the island. Cheap and idempotent; call whenever a drag
// might be starting.

use std::cell::UnsafeCell;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::ptr;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{implement, BOOL};
use windows::Win32::Foundation::{DRAGDROP_E_INVALIDHWND, HWND, LPARAM, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, RevokeDragDrop, CF_HDROP, DROPEFFECT,
    DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragFinish, DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

use crate::events;
use crate::island;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Kept alive for the process lifetime. `IDropTarget` is !Send; we only touch
/// this on the UI thread (setup / `run_on_main_thread`).
struct TargetBox(Vec<IDropTarget>);
unsafe impl Send for TargetBox {}
unsafe impl Sync for TargetBox {}
static TARGETS: Mutex<TargetBox> = Mutex::new(TargetBox(Vec::new()));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileDragPayload {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    paths: Option<Vec<String>>,
}

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

fn emit(kind: &'static str, paths: Option<Vec<String>>) {
    let Some(app) = APP.get() else { return };
    let payload = FileDragPayload { kind, paths };
    let _ = app.emit_to(island::WINDOW_LABEL, events::FILE_DRAG, payload);
}

/// Revoke WebView2 / stale targets and register ours on every eligible HWND.
pub fn ensure_targets(app: &AppHandle) {
    let _ = APP.get_or_init(|| app.clone());
    let Some(win) = app.get_webview_window(island::WINDOW_LABEL) else {
        crate::log::line("file-drop: island window missing");
        return;
    };
    let Ok(hwnd) = win.hwnd() else {
        crate::log::line("file-drop: no hwnd");
        return;
    };
    let hwnd = HWND(hwnd.0 as *mut _);

    let mut registered = Vec::new();
    inject(hwnd, &mut registered);

    // Enumerate descendants (WebView2 render widget lives here).
    let mut state = EnumState {
        registered: &mut registered,
    };
    unsafe {
        let _ = EnumChildWindows(
            Some(hwnd),
            Some(enum_callback),
            LPARAM(&mut state as *mut EnumState as isize),
        );
    }

    let n = registered.len();
    if let Ok(mut guard) = TARGETS.lock() {
        guard.0 = registered;
    }
    crate::log::line(format!("file-drop: registered {n} OLE target(s)"));
}

struct EnumState<'a> {
    registered: &'a mut Vec<IDropTarget>,
}

unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut EnumState);
    inject(hwnd, state.registered);
    true.into()
}

fn inject(hwnd: HWND, out: &mut Vec<IDropTarget>) {
    let target: IDropTarget = FileDropTarget::new(hwnd).into();
    let revoke = unsafe { RevokeDragDrop(hwnd) };
    // INVALIDHWND → this HWND cannot host a drop target; skip.
    if revoke == Err(DRAGDROP_E_INVALIDHWND.into()) {
        return;
    }
    if unsafe { RegisterDragDrop(hwnd, &target) }.is_ok() {
        out.push(target);
    }
}

#[implement(IDropTarget)]
struct FileDropTarget {
    hwnd: HWND,
    cursor_effect: UnsafeCell<DROPEFFECT>,
    enter_is_valid: UnsafeCell<bool>,
}

impl FileDropTarget {
    fn new(hwnd: HWND) -> Self {
        Self {
            hwnd,
            cursor_effect: UnsafeCell::new(DROPEFFECT_NONE),
            enter_is_valid: UnsafeCell::new(false),
        }
    }

    unsafe fn iterate_filenames<F>(data_obj: &IDataObject, mut callback: F) -> Option<HDROP>
    where
        F: FnMut(PathBuf),
    {
        let drop_format = FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };

        match data_obj.GetData(&drop_format) {
            Ok(medium) => {
                let hdrop = HDROP(medium.u.hGlobal.0 as _);
                let item_count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
                for i in 0..item_count {
                    let character_count = DragQueryFileW(hdrop, i, None) as usize;
                    let mut path_buf = vec![0u16; character_count + 1];
                    DragQueryFileW(hdrop, i, Some(&mut path_buf));
                    callback(OsString::from_wide(&path_buf[..character_count]).into());
                }
                Some(hdrop)
            }
            Err(_) => None,
        }
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for FileDropTarget_Impl {
    fn DragEnter(
        &self,
        pDataObj: windows::core::Ref<'_, IDataObject>,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let mut client = POINT { x: pt.x, y: pt.y };
        let _ = unsafe { ScreenToClient(self.hwnd, &mut client) };

        let Some(data) = pDataObj.as_ref() else {
            return Ok(());
        };
        let mut paths = Vec::new();
        let hdrop = unsafe { FileDropTarget::iterate_filenames(data, |p| paths.push(p)) };
        let valid = hdrop.is_some();
        unsafe {
            *self.enter_is_valid.get() = valid;
        }
        if !valid {
            return Ok(());
        }

        let path_strs: Vec<String> = paths
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        crate::log::line(format!("file-drop enter {} path(s)", path_strs.len()));
        emit("enter", Some(path_strs));

        let effect = DROPEFFECT_COPY;
        unsafe {
            *pdwEffect = effect;
            *self.cursor_effect.get() = effect;
        }
        Ok(())
    }

    fn DragOver(
        &self,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        if unsafe { *self.enter_is_valid.get() } {
            emit("over", None);
        }
        unsafe {
            *pdwEffect = *self.cursor_effect.get();
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        if unsafe { *self.enter_is_valid.get() } {
            crate::log::line("file-drop leave");
            emit("leave", None);
            unsafe {
                *self.enter_is_valid.get() = false;
            }
        }
        Ok(())
    }

    fn Drop(
        &self,
        pDataObj: windows::core::Ref<'_, IDataObject>,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        _pdwEffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        if !unsafe { *self.enter_is_valid.get() } {
            return Ok(());
        }
        let mut client = POINT { x: pt.x, y: pt.y };
        let _ = unsafe { ScreenToClient(self.hwnd, &mut client) };

        let Some(data) = pDataObj.as_ref() else {
            return Ok(());
        };
        let mut paths = Vec::new();
        let hdrop = unsafe { FileDropTarget::iterate_filenames(data, |p| paths.push(p)) };
        let path_strs: Vec<String> = paths
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        crate::log::line(format!("file-drop drop {} path(s)", path_strs.len()));
        emit("drop", Some(path_strs));

        if let Some(hdrop) = hdrop {
            unsafe {
                DragFinish(hdrop);
            }
        }
        unsafe {
            *self.enter_is_valid.get() = false;
        }
        Ok(())
    }
}
