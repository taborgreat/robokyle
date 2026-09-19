// Grip wheel layout, clockwise from straight up. Every grip runs from an open hand to
// its closed pose under flexor / extensor, so poses with nothing to close to (open,
// relax) do not belong here. Positions are learned by feel: append, do not reorder.
// A grip names the Brunel gesture or intent the hand shows for it; finger targets are
// learned from the hand, not duplicated here.
export const GRIPS = [
  { label: 'Fist', gesture: 'power_grip' },
  { label: 'Pinch', gesture: 'pinch' },
  { label: 'Point', gesture: 'point' },
  { label: 'Tripod', gesture: 'tripod' },
  { label: 'Key', gesture: 'key_grip' },
  { label: 'Thumbs up', intent: 'thumbs_up' },
];

export const DEFAULT_GRIP = 0;
