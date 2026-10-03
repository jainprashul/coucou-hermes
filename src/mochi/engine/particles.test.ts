import { describe, it, expect } from "vitest";
import {
  createParticle,
  spawnParticles,
  updateParticles,
  ParticleSystem,
  ParticleManager,
  type ParticleType,
} from "./particles";
import * as Engine from "../engine";

describe("engine particle internals", () => {
  it("creates non-z particle with exact deterministic formulas", () => {
    // Mock RNG returning a fixed value, e.g. 0.5
    const mockRng = () => 0.5;
    const p = createParticle("heart", 0, mockRng);

    expect(p.type).toBe("heart");
    // (0.5 - 0.5) * 0.9 + 0 = 0
    expect(p.x).toBeCloseTo(0, 5);
    // -0.7 - 0.5 * 0.2 = -0.8
    expect(p.y).toBeCloseTo(-0.8, 5);
    // (0.5 - 0.5) * 0.35 + 0 = 0
    expect(p.vx).toBeCloseTo(0, 5);
    // -(0.45 + 0.5 * 0.35) = -0.625
    expect(p.vy).toBeCloseTo(-0.625, 5);
    // -0 * 0.14 = 0
    expect(p.age).toBeCloseTo(0, 5);
    // 1.3 + 0.5 * 0.5 = 1.55
    expect(p.life).toBeCloseTo(1.55, 5);
    // 0.5 * Math.PI * 2 = Math.PI
    expect(p.rot).toBeCloseTo(Math.PI, 5);
    // 0.15 + 0.5 * 0.08 = 0.19
    expect(p.size).toBeCloseTo(0.19, 5);
  });

  it("applies z particle offsets and staggered ages", () => {
    const mockRng = () => 0.5;
    const pZ = createParticle("z", 2, mockRng);

    expect(pZ.type).toBe("z");
    // (0.5 - 0.5) * 0.9 + 0.55 = 0.55
    expect(pZ.x).toBeCloseTo(0.55, 5);
    // (0.5 - 0.5) * 0.35 + 0.18 = 0.18
    expect(pZ.vx).toBeCloseTo(0.18, 5);
    // -2 * 0.14 = -0.28
    expect(pZ.age).toBeCloseTo(-0.28, 5);
  });

  it("spawns correct count with staggered age indices", () => {
    const types: ParticleType[] = ["heart", "star", "spark", "sweat", "z"];
    for (const t of types) {
      const batch = spawnParticles(t, 4);
      expect(batch).toHaveLength(4);
      expect(batch[0].age).toBeCloseTo(0, 5);
      expect(batch[1].age).toBeCloseTo(-0.14, 5);
      expect(batch[2].age).toBeCloseTo(-0.28, 5);
      expect(batch[3].age).toBeCloseTo(-0.42, 5);
      for (const p of batch) {
        expect(p.type).toBe(t);
        expect(p.life).toBeGreaterThanOrEqual(1.3);
        expect(p.life).toBeLessThanOrEqual(1.8);
        expect(p.size).toBeGreaterThanOrEqual(0.15);
        expect(p.size).toBeLessThanOrEqual(0.23);
      }
    }
  });

  it("updates particle age and prunes expired particles", () => {
    const p1 = createParticle("heart", 0, () => 0.5); // life: 1.55, age: 0
    const p2 = createParticle("star", 0, () => 0.0); // life: 1.30, age: 0
    let list = [p1, p2];

    // dt = 1.0 -> p1.age = 1.0 (alive), p2.age = 1.0 (alive)
    list = updateParticles(list, 1.0);
    expect(list).toHaveLength(2);
    expect(list[0].age).toBeCloseTo(1.0, 5);
    expect(list[1].age).toBeCloseTo(1.0, 5);

    // dt = 0.4 -> p1.age = 1.4 (alive < 1.55), p2.age = 1.4 (expired >= 1.30)
    list = updateParticles(list, 0.4);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe("heart");
    expect(list[0].age).toBeCloseTo(1.4, 5);

    // dt = 0.2 -> p1.age = 1.6 (expired >= 1.55)
    list = updateParticles(list, 0.2);
    expect(list).toHaveLength(0);
  });

  it("ParticleSystem manages lifecycle and emission", () => {
    const sys = new ParticleSystem();
    expect(sys.busy).toBe(false);
    expect(sys.count).toBe(0);

    sys.emit("sweat", 3);
    expect(sys.busy).toBe(true);
    expect(sys.count).toBe(3);

    // Advance by 3 seconds, all should expire
    sys.update(3.0);
    expect(sys.busy).toBe(false);
    expect(sys.count).toBe(0);

    sys.emit("spark", 2);
    expect(sys.count).toBe(2);
    sys.clear();
    expect(sys.count).toBe(0);
    expect(sys.busy).toBe(false);
  });

  it("ParticleManager alias refers to ParticleSystem", () => {
    expect(ParticleManager).toBe(ParticleSystem);
  });

  it("preserves re-exports on mochi/engine facade", () => {
    expect(Engine.ParticleSystem).toBe(ParticleSystem);
    expect(Engine.ParticleManager).toBe(ParticleManager);
    expect(Engine.createParticle).toBe(createParticle);
    expect(Engine.spawnParticles).toBe(spawnParticles);
    expect(Engine.updateParticles).toBe(updateParticles);
  });
});
