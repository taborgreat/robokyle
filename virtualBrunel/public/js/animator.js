// Follows the server's joint state between snapshots: each joint moves towards its
// target at the rate the hand reported, and snaps to the reported position at rest.
export function createAnimator() {
  const joints = {};

  return {
    sync(snapshot) {
      for (const [name, { position, target, rate }] of Object.entries(snapshot)) {
        const joint = (joints[name] ??= { current: position });
        Object.assign(joint, { target, rate });
        if (!rate) joint.current = position;
      }
    },

    // Advances by dt ms and returns the pose as { joint: 0–100 }.
    step(dt) {
      const pose = {};
      for (const [name, joint] of Object.entries(joints)) {
        const gap = joint.target - joint.current;
        joint.current += Math.sign(gap) * Math.min(Math.abs(gap), joint.rate * dt);
        pose[name] = joint.current;
      }
      return pose;
    },
  };
}
