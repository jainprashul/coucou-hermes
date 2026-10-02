// One base64 encoder for the whole Rust side, instead of one copy per module.
//
// Consumers:
//   - `claude.rs`      — file bytes sent to the Anthropic API as `base64` blocks
//   - `hermes_ws.rs`   — `Authorization: Basic …` header on the gateway handshake
//   - `integrations.rs`— Stripe's basic-auth header
//
// Standard alphabet with `=` padding (RFC 4648 §4). No URL-safe variant and
// no decoder are needed anywhere in the app, so there is no reason to pull in
// a dependency for this.

pub fn encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn matches_rfc4648_vectors() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn encodes_basic_auth_credentials() {
        // The shape hermes_ws.rs and integrations.rs actually feed in.
        assert_eq!(encode(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(encode(b"api-key:sk-abc123"), "YXBpLWtleTpzay1hYmMxMjM=");
    }
}