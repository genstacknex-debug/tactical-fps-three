// First-person movement: acceleration, friction, gravity, crouch, walk and jump, resolved
// as a box against the world's colliders one axis at a time. Weapon recoil lives here too so
// the camera kick and the bullet direction never disagree.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.62;
const CROUCH_EYE = 1.04;
const WALK_SPEED = 5.7;
const SLOW_SPEED = 3.15;
const CROUCH_SPEED = 2.55;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const GRAVITY = 20.5;
const JUMP_SPEED = 6.35;

export function createPlayer(colliders, spawn) {
  const player = {
    position: new THREE.Vector3(spawn?.x ?? 0, 0, spawn?.z ?? 17),
    velocity: new THREE.Vector3(),
    yaw: spawn?.yaw ?? 0,
    pitch: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    walking: false,
    height: STAND_HEIGHT,
    bob: 0,
    bobPhase: 0,
    alive: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.recoilPitch = Math.min(0.32, player.recoilPitch + pitchKick);
    player.recoilYaw = Math.max(-0.16, Math.min(0.16, player.recoilYaw + yawKick));
  }

  function respawn(nextSpawn) {
    player.position.set(nextSpawn.x, 0, nextSpawn.z);
    player.velocity.set(0, 0, 0);
    player.yaw = nextSpawn.yaw ?? 0;
    player.pitch = 0;
    player.recoilPitch = 0;
    player.recoilYaw = 0;
    player.eye = STAND_EYE;
    player.height = STAND_HEIGHT;
    player.crouching = false;
    player.walking = false;
    player.onGround = true;
    player.alive = true;
    player.bob = 0;
  }

  function step(dt, keys, enabled = true) {
    const recovery = Math.max(0, 1 - dt * 7.5);
    player.recoilPitch *= recovery;
    player.recoilYaw *= recovery;
    if (Math.abs(player.recoilPitch) < 1e-4) player.recoilPitch = 0;
    if (Math.abs(player.recoilYaw) < 1e-4) player.recoilYaw = 0;

    if (!enabled || !player.alive) {
      player.velocity.x = 0;
      player.velocity.z = 0;
      player.velocity.y = Math.max(player.velocity.y - GRAVITY * dt, -30);
      player.position.y += player.velocity.y * dt;
      if (player.position.y <= 0) {
        player.position.y = 0;
        player.velocity.y = 0;
        player.onGround = true;
      }
      return;
    }

    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    player.walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : player.walking ? SLOW_SPEED : WALK_SPEED;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;

    const nextX = player.position.x + player.velocity.x * dt;
    if (!overlaps(nextX, player.position.y, player.position.z, player.height, 0.04)) player.position.x = nextX;
    else player.velocity.x = 0;
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!overlaps(player.position.x, player.position.y, nextZ, player.height, 0.04)) player.position.z = nextZ;
    else player.velocity.z = 0;

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(-30, player.velocity.y);

    const groundSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.onGround && groundSpeed > 0.8) {
      player.bobPhase += dt * (7 + groundSpeed * 1.15);
      player.bob = Math.sin(player.bobPhase) * 0.018 * Math.min(1, groundSpeed / WALK_SPEED);
    } else {
      player.bob += (0 - player.bob) * Math.min(1, dt * 8);
    }
  }

  return {
    state: player,
    step,
    look,
    recoil,
    respawn,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
    moving() {
      return this.groundSpeed() > 0.55;
    },
    eyePosition(target = new THREE.Vector3()) {
      return target.set(player.position.x, player.position.y + player.eye + player.bob, player.position.z);
    },
  };
}
