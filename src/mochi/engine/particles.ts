export type ParticleType = "heart" | "star" | "spark" | "sweat" | "z";

export interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  rot: number;
  size: number;
}

/**
 * Spawns a single particle matching the exact Swift / Mochi constants and initial offsets.
 */
export function createParticle(
  type: ParticleType,
  index = 0,
  rng = Math.random,
): Particle {
  const isZ = type === "z";
  return {
    type,
    x: (rng() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
    y: -0.7 - rng() * 0.2,
    vx: (rng() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
    vy: -(0.45 + rng() * 0.35),
    age: -index * 0.14,
    life: 1.3 + rng() * 0.5,
    rot: rng() * Math.PI * 2,
    size: 0.15 + rng() * 0.08,
  };
}

/**
 * Spawns a list of particles with staggered ages according to the index.
 */
export function spawnParticles(
  type: ParticleType,
  count: number,
  rng = Math.random,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push(createParticle(type, i, rng));
  }
  return particles;
}

/**
 * Ages all particles and filters out expired ones whose age >= life.
 */
export function updateParticles(particles: Particle[], dt: number): Particle[] {
  for (const p of particles) p.age += dt;
  return particles.filter((p) => p.age < p.life);
}

/**
 * Encapsulates the particle state, emission, and lifecycle update loop.
 */
export class ParticleSystem {
  particles: Particle[] = [];

  get count(): number {
    return this.particles.length;
  }

  get busy(): boolean {
    return this.particles.length > 0;
  }

  emit(type: ParticleType, count: number, rng = Math.random): Particle[] {
    const spawned: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const p = createParticle(type, i, rng);
      this.particles.push(p);
      spawned.push(p);
    }
    return spawned;
  }

  update(dt: number): void {
    this.particles = updateParticles(this.particles, dt);
  }

  clear(): void {
    this.particles = [];
  }
}

export { ParticleSystem as ParticleManager };
