export const FIRMWARE = '1.0.0';

export const MAX_BODY_BYTES = 512;
export const MAX_FAULTS = 20;
export const MAX_CUSTOM_GESTURES = 16;

export const DEFAULT_SPEED = 60;
export const DEFAULT_FORCE_LIMIT_N = 15;
export const WATCHDOG_TIMEOUT_MS = 2000;
export const REBOOT_DELAY_MS = 500;
export const REBOOT_OFFLINE_MS = 5000;

// Time for a joint to travel 0 → 100 % at speed 100. Chosen so the estimated durations
// match the spec's examples (pinch at speed 70 ≈ 450 ms, grasp_cylinder ≈ 520 ms).
export const FULL_TRAVEL_MS = 400;

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// Everything the simulation animates: the five fingers plus thumb opposition.
export const JOINTS = [...FINGERS, 'thumb_rotator'];

export const ACTUATORS = {
  thumb_flexor: { joints: ['thumb'], min_pwm: 40, max_pwm: 210 },
  thumb_rotator: { joints: ['thumb_rotator'], min_pwm: 40, max_pwm: 210 },
  index_flexor: { joints: ['index'], min_pwm: 35, max_pwm: 220 },
  middle_flexor: { joints: ['middle'], min_pwm: 38, max_pwm: 215 },
  ring_pinky_flexor: { joints: ['ring', 'pinky'], min_pwm: 36, max_pwm: 218 },
};

export const FINGER_RANGE = {
  thumb: { actuator: 'thumb_flexor', max_deg: 90 },
  index: { actuator: 'index_flexor', max_deg: 95 },
  middle: { actuator: 'middle_flexor', max_deg: 93 },
  ring: { actuator: 'ring_pinky_flexor', max_deg: 90 },
  pinky: { actuator: 'ring_pinky_flexor', max_deg: 85 },
};

const pose = (thumb, index, middle, ring, pinky, thumb_rotator) => ({
  thumb, index, middle, ring, pinky, thumb_rotator,
});

export const GESTURES = {
  open: pose(0, 0, 0, 0, 0, 0),
  close: pose(100, 100, 100, 100, 100, 60),
  pinch: pose(70, 80, 25, 25, 25, 100),
  tripod: pose(70, 80, 80, 0, 0, 100),
  power_grip: pose(80, 90, 90, 85, 80, 100),
  key_grip: pose(85, 100, 100, 100, 100, 50),
  point: pose(80, 0, 100, 100, 100, 60),
  ok: pose(75, 85, 0, 0, 0, 100),
  relax: pose(20, 25, 25, 30, 30, 30),
};

// `gesture` is what /intent reports as the resolved gesture; `pose` is the base target
// table before object-size adjustment. `waves` makes it an animated open/curl sequence.
export const INTENTS = {
  grasp_cylinder: { description: 'Cylindrical object power grip', gesture: 'power_grip', sized: true, pose: GESTURES.power_grip },
  grasp_sphere: { description: 'Spherical object grasp', gesture: 'power_grip', sized: true, pose: pose(70, 75, 75, 75, 70, 100) },
  grasp_flat: { description: 'Flat object grasp (card, plate)', gesture: 'key_grip', sized: true, pose: GESTURES.key_grip },
  pinch_small: { description: 'Fine fingertip pinch', gesture: 'pinch', sized: false, pose: pose(70, 80, 0, 0, 0, 100) },
  pinch_large: { description: 'Three-finger pinch', gesture: 'tripod', sized: false, pose: GESTURES.tripod },
  writing_grip: { description: 'Pen/pencil holding grip', gesture: 'tripod', sized: false, pose: pose(65, 75, 80, 60, 60, 100) },
  phone_grip: { description: 'Smartphone or flat device hold', gesture: 'key_grip', sized: false, pose: pose(70, 75, 75, 75, 75, 50) },
  tool_grip: { description: 'Handle or tool shaft grip', gesture: 'power_grip', sized: true, pose: pose(85, 95, 95, 95, 90, 100) },
  wave_hello: { description: 'Wave animation sequence', gesture: 'sequence', sized: false, pose: GESTURES.open, waves: 3 },
  thumbs_up: { description: 'Thumbs up', gesture: 'custom', sized: false, pose: pose(0, 100, 100, 100, 100, 0) },
};

// Aperture adjustment applied to finger targets for intents that support object_size.
export const SIZE_SCALE = { small: 1.1, medium: 1, large: 0.85 };
