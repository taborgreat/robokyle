/* ============================================================
   Robo Kyle — HAND: the anatomy data.

   Everything the 3D page knows about the arm lives here: bone sizes,
   joint ranges, where each muscle and nerve runs, and the text shown
   when you click on one. hand.js turns this into geometry; it has no
   anatomy of its own.

   Coordinates are centimetres in a BONE'S OWN FRAME:
       +X  runs down the bone, from its proximal joint toward the hand
       +Y  the radial (thumb) side; -Y the ulnar (little-finger) side
       +Z  the palmar / anterior surface; -Z the dorsal / posterior one
   so a muscle waypoint ["ulna", 12, -2.6, 1.6] is 12 cm down the
   forearm, on the ulnar side, on the palmar face, and it moves with the
   forearm when the elbow bends. "forearm" is the frame that pronates
   (radius and ulna share it), "wrist" is the carpus, "mc2".."mc5" the
   finger metacarpals, "pp/mp/dp" proximal/middle/distal phalanges,
   "mc1/pp1/dp1" the thumb.

   This is a right arm. None of it comes from measured EMG or SNC data —
   it is textbook proportions of an average adult arm, drawn for
   teaching, and it will stay that way until real sensors are wired in.
   ============================================================ */

export const FINGERS = [
  // id, label, metacarpal length, proximal, middle, distal phalanx lengths,
  // metacarpal base position on the carpus (x, y, z), base splay in degrees
  { id: 2, key: 'index',  label: 'Index finger',  mc: 6.9, pp: 4.0, mp: 2.4, dp: 1.7, base: [3.3,  1.20, 0.10], splay:  3 },
  { id: 3, key: 'middle', label: 'Middle finger', mc: 6.5, pp: 4.4, mp: 2.8, dp: 1.9, base: [3.4,  0.35, 0.00], splay:  0 },
  { id: 4, key: 'ring',   label: 'Ring finger',   mc: 5.8, pp: 4.2, mp: 2.7, dp: 1.8, base: [3.3, -0.50, 0.00], splay: -4 },
  { id: 5, key: 'little', label: 'Little finger', mc: 5.4, pp: 3.3, mp: 1.9, dp: 1.6, base: [3.1, -1.30, 0.10], splay: -9 },
];

export const THUMB = { mc: 4.6, pp: 3.2, dp: 2.2, base: [2.9, 1.9, 0.6], dir: [0.55, 0.75, 0.35] };

export const ARM = { humerus: 30, ulna: 26, radius: 24.5, wristAt: 25.5 };

/* The eight carpal bones: name, centre in the wrist frame, radii (x, y, z). */
export const CARPALS = [
  { id: 'scaphoid',   name: 'Scaphoid',   pos: [1.2,  1.35,  0.25], r: [0.75, 0.55, 0.50],
    text: 'Boat-shaped, on the thumb side of the proximal row. It bridges both rows, which is why it is the most commonly fractured carpal — a fall on an outstretched hand loads it directly. Its blood supply enters distally, so a proximal fracture can starve the bone.' },
  { id: 'lunate',     name: 'Lunate',     pos: [1.0,  0.15,  0.10], r: [0.55, 0.55, 0.55],
    text: 'Crescent-shaped, in the middle of the proximal row, sitting in the cup of the radius. Most wrist flexion and extension happens at the radius–lunate–scaphoid surface. The lunate is the carpal that dislocates most often.' },
  { id: 'triquetrum', name: 'Triquetrum', pos: [0.9, -1.10, -0.20], r: [0.55, 0.50, 0.45],
    text: 'Three-cornered, on the ulnar side of the proximal row. It does not touch the ulna directly — a fibrocartilage disc (the TFCC) sits between them, which is why the ulna takes little of the load through the wrist.' },
  { id: 'pisiform',   name: 'Pisiform',   pos: [0.7, -1.45,  0.60], r: [0.40, 0.40, 0.35],
    text: 'Pea-sized, sitting on the palmar face of the triquetrum. It is a sesamoid bone inside the tendon of flexor carpi ulnaris, and the ulnar nerve runs right beside it into the hand. You can feel it at the base of the little-finger side of the palm.' },
  { id: 'trapezium',  name: 'Trapezium',  pos: [2.6,  1.85,  0.50], r: [0.60, 0.55, 0.50],
    text: 'The thumb sits on this one. Its saddle-shaped surface is what gives the thumb carpometacarpal joint its freedom — flexion, abduction and the rotation that makes opposition possible. Arthritis of this joint is the classic "thumb base" pain.' },
  { id: 'trapezoid',  name: 'Trapezoid',  pos: [2.7,  0.90,  0.20], r: [0.45, 0.45, 0.45],
    text: 'Small and wedge-shaped, locked between the trapezium and the capitate. It carries the index metacarpal, which barely moves — the index finger needs a rigid base to push against.' },
  { id: 'capitate',   name: 'Capitate',   pos: [2.7,  0.00,  0.00], r: [0.65, 0.65, 0.60],
    text: 'The largest carpal and the keystone of the wrist, at the centre of the distal row. Its head sits in the cup formed by the scaphoid and lunate; the middle metacarpal rides on top of it. The axis of wrist rotation passes through its head.' },
  { id: 'hamate',     name: 'Hamate',     pos: [2.6, -1.10,  0.00], r: [0.60, 0.60, 0.55],
    text: 'Wedge-shaped, on the ulnar side of the distal row, with a hook on its palmar face. The hook forms the outer wall of Guyon’s canal (where the ulnar nerve passes) and anchors the flexor retinaculum over the carpal tunnel.' },
];

/* Text for the long bones. Finger and thumb bones are described once. */
export const BONE_TEXT = {
  humerus: { name: 'Humerus', text: 'The upper-arm bone. Its ball-shaped head sits in the shoulder socket; its lower end widens into two condyles that form the elbow. The two bumps you can feel at your elbow — medial and lateral epicondyles — are where most forearm flexors (medial) and extensors (lateral) begin. The radial nerve spirals around the back of the shaft, which is why a mid-shaft fracture can cause wrist drop.',
    articulates: 'Scapula (glenoid) at the shoulder; ulna and radius at the elbow.' },
  ulna:    { name: 'Ulna', text: 'The forearm bone on the little-finger side, thickest at the elbow where its hook (the olecranon) wraps the humerus and forms the point of your elbow. It is the stable post of the forearm: the radius rotates around it during pronation and supination. It thins toward the wrist and does not touch the carpal bones directly.',
    articulates: 'Humerus (trochlea), radius at both ends, and the wrist disc.' },
  radius:  { name: 'Radius', text: 'The forearm bone on the thumb side, thin at the elbow and wide at the wrist, where it carries almost all the load from the hand. Its disc-shaped head spins against the humerus and ulna, letting the whole bone — and the hand with it — roll over the ulna to turn the palm down. Biceps inserts on its tuberosity, which is why biceps is the strongest supinator.',
    articulates: 'Humerus (capitulum), ulna at both ends, scaphoid and lunate at the wrist.' },
  mc:      { name: 'Metacarpal', text: 'The five long bones of the palm. Their bases lock into the carpal bones; their rounded heads are the knuckles. The second and third barely move, giving the hand a rigid centre to push and grip against, while the fourth and fifth flex a little at their bases so the palm can cup.' },
  pp:      { name: 'Proximal phalanx', text: 'The first and longest bone of each digit, from knuckle to the first finger joint. The extensor expansion wraps over its back, and the flexor tendons run in a fibrous tunnel along its palmar face.' },
  mp:      { name: 'Middle phalanx', text: 'The second bone of each finger. Flexor digitorum superficialis inserts on its sides; flexor digitorum profundus passes straight through, between the two slips, to reach the fingertip. The thumb has no middle phalanx.' },
  dp:      { name: 'Distal phalanx', text: 'The fingertip bone, flattened into a tuft that supports the nail and the pulp. Flexor digitorum profundus pulls on its base from the palmar side and the extensor tendon from the dorsal side — the two most-injured tendon insertions in the hand ("jersey finger" and "mallet finger").' },
  mc1:     { name: 'First metacarpal (thumb)', text: 'Shorter and stouter than the others, and set at nearly a right angle to the palm. Because it sits on the saddle of the trapezium it can swing across the palm — this bone is what makes the thumb opposable.' },
  pp1:     { name: 'Proximal phalanx of the thumb', text: 'The thumb has only two phalanges. Flexor pollicis brevis and the abductor insert on its base from the thumb side, adductor pollicis from the palm side, and extensor pollicis brevis on its back.' },
  dp1:     { name: 'Distal phalanx of the thumb', text: 'The thumb tip. Flexor pollicis longus inserts on its base (palmar) and extensor pollicis longus on its back — the long tendon you can see when you lift the thumb.' },
};

/* Joints: name, type, motion, plain-language text. Ranges are what the
   model allows; they follow typical adult values. */
export const JOINT_TEXT = {
  shoulder: { name: 'Shoulder (glenohumeral) joint', type: 'Ball and socket',
    motion: 'Flexion / extension, abduction / adduction, internal / external rotation — the most mobile joint in the body.',
    text: 'The humeral head is much bigger than the shallow socket it sits in, so mobility is bought with instability. The rotator cuff muscles hold the ball centred while the deltoid lifts the arm. In this model the shoulder is a free pointing joint: drag the upper arm to aim it, Shift-drag to roll it.' },
  elbow: { name: 'Elbow (humeroulnar) joint', type: 'Hinge',
    motion: 'Flexion 0–145°.',
    text: 'The hook of the ulna wraps the spool-shaped trochlea of the humerus, which makes the elbow a nearly pure hinge. Brachialis and biceps flex it; triceps extends it. The ulnar nerve runs in the groove behind the medial epicondyle — that is the "funny bone".' },
  pronation: { name: 'Radioulnar joints (pronation / supination)', type: 'Pivot (two joints working together)',
    motion: 'Pronation ~75°, supination ~85°.',
    text: 'The radius spins in a ligament ring at the elbow and swings around the ulna at the wrist, carrying the hand with it: palm down is pronation, palm up is supination. Pronator teres and pronator quadratus turn the palm down; biceps and supinator turn it up. In the model the whole forearm rotates as one piece — the real crossing of the two bones is simplified. Shift-drag the forearm to turn it.' },
  wrist: { name: 'Wrist (radiocarpal) joint', type: 'Ellipsoid (condyloid)',
    motion: 'Flexion ~75°, extension ~70°, radial deviation ~20°, ulnar deviation ~35°.',
    text: 'The scaphoid and lunate sit in the cup of the radius; the ulna is separated from the carpus by a cartilage disc. Flexion and extension are shared between this joint and the midcarpal joint between the two carpal rows. Drag the palm to flex and extend; Shift-drag to tilt it side to side.' },
  cmc1: { name: 'Thumb carpometacarpal joint', type: 'Saddle',
    motion: 'Flexion / extension across the palm, palmar abduction / adduction, and the rotation that produces opposition.',
    text: 'Two saddle-shaped surfaces at right angles: the base of the first metacarpal rocking on the trapezium. It is the joint that lets the thumb pad meet each fingertip, and the joint that wears out first in many hands. Drag the thumb to curl it; Shift-drag to swing it away from the palm.' },
  mcp1: { name: 'Thumb metacarpophalangeal joint', type: 'Hinge (with a little side play)', motion: 'Flexion ~55°.',
    text: 'The thumb knuckle. Flexor pollicis brevis bends it, extensor pollicis brevis straightens it. Its ulnar collateral ligament is the one torn in "skier’s thumb".' },
  ip1: { name: 'Thumb interphalangeal joint', type: 'Hinge', motion: 'Flexion ~80°, some hyperextension.',
    text: 'The single joint in the thumb beyond the knuckle, worked by the two long thumb tendons: flexor pollicis longus and extensor pollicis longus.' },
  mcp: { name: 'Metacarpophalangeal joint', type: 'Condyloid', motion: 'Flexion ~90°, extension ~30°, spread ±20°.',
    text: 'The knuckle. It flexes and extends like a hinge and also lets the fingers spread and close, which is what the interossei do. Collateral ligaments go tight in flexion, so a fist locks the fingers side to side — and a hand splinted with the knuckles straight will stiffen in a bad position.' },
  pip: { name: 'Proximal interphalangeal joint', type: 'Hinge', motion: 'Flexion ~100°.',
    text: 'The middle joint of the finger and the biggest contributor to grip. Flexor digitorum superficialis is its dedicated flexor; the central slip of the extensor tendon straightens it.' },
  dip: { name: 'Distal interphalangeal joint', type: 'Hinge', motion: 'Flexion ~70°.',
    text: 'The end joint of the finger. Only flexor digitorum profundus can bend it, which is how the profundus tendon is tested in clinic: hold the middle phalanx straight and ask the patient to bend the tip.' },
};

/* ------------------------------------------------------------ muscles
   Each strand is a list of waypoints [frame, x, y, z] and a radius
   profile [[t, r], ...] along the strand (t = 0 at the first point).
   Thick where the belly is, thin where it becomes tendon. */

const fingerFrames = { 2: 'index', 3: 'middle', 4: 'ring', 5: 'little' };
const tendonY = { 2: 0.9, 3: 0.3, 4: -0.3, 5: -0.9 };

function flexorTendons(fromX, z, endBone, endZ, endX) {
  return [2, 3, 4, 5].map(i => ({
    pts: [
      ['forearm', fromX, tendonY[i], z],
      ['wrist', 1.5, tendonY[i] * 0.8, z],
      ['wrist', 3.3, tendonY[i] * 0.6, z - 0.05],
      [`mc${i}`, 0.6, 0, z - 0.1],
      [`mc${i}`, 'len-0.4', 0, z - 0.15],
      [`pp${i}`, 0.4, 0, 0.45],
      endBone === 'mp'
        ? [`pp${i}`, 'len-0.3', 0, 0.4]
        : [`mp${i}`, 0.3, 0, 0.33],
      endBone === 'mp'
        ? [`mp${i}`, endX, 0, endZ]
        : [`dp${i}`, endX, 0, endZ],
    ],
    r: [[0, 0.24], [1, 0.16]],
  }));
}

function extensorTendons(fromX) {
  return [2, 3, 4, 5].map(i => ({
    pts: [
      ['forearm', fromX, tendonY[i], -1.0],
      ['wrist', 1.5, tendonY[i] * 0.9, -0.9],
      ['wrist', 3.3, tendonY[i] * 0.6, -0.7],
      [`mc${i}`, 0.6, 0, -0.62],
      [`mc${i}`, 'len-0.3', 0, -0.58],
      [`pp${i}`, 0.5, 0, -0.45],
      [`pp${i}`, 'len-0.3', 0, -0.4],
      [`mp${i}`, 0.3, 0, -0.36],
      [`mp${i}`, 'len-0.3', 0, -0.32],
      [`dp${i}`, 0.45, 0, -0.26],
    ],
    r: [[0, 0.22], [1, 0.12]],
  }));
}

export const MUSCLES = [
  /* ----- upper arm ----- */
  { id: 'biceps', name: 'Biceps brachii', group: 'arm',
    strands: [{ pts: [['humerus', 0.8, 1.0, 1.9], ['humerus', 10, 0.3, 3.3], ['humerus', 22, 0, 3.2], ['humerus', 29, 0.4, 2.0], ['forearm', 3.2, 1.4, 0.9]],
                r: [[0, 0.5], [0.3, 1.5], [0.6, 1.5], [0.85, 0.5], [1, 0.3]] }],
    origin: 'Long head: supraglenoid tubercle of the scapula. Short head: coracoid process.',
    insertion: 'Radial tuberosity, and the bicipital aponeurosis into the forearm fascia.',
    action: 'Supinates the forearm and flexes the elbow — strongest with the palm up. Weak shoulder flexor.',
    nerve: 'Musculocutaneous nerve (C5, C6).',
    text: 'The muscle everyone knows, and the one most people misdescribe: its main job is turning the palm up, not bending the elbow. Try it — tighten your elbow with the palm down and the biceps stays soft; turn the palm up and it hardens.' },
  { id: 'brachialis', name: 'Brachialis', group: 'arm',
    strands: [{ pts: [['humerus', 14, 0.2, 2.2], ['humerus', 24, -0.2, 2.5], ['humerus', 30, -0.4, 1.6], ['forearm', 1.6, -0.8, 1.0]],
                r: [[0, 0.4], [0.4, 1.2], [0.8, 0.6], [1, 0.3]] }],
    origin: 'Anterior surface of the lower half of the humerus.', insertion: 'Coronoid process and tuberosity of the ulna.',
    action: 'Flexes the elbow in every forearm position — the workhorse flexor.', nerve: 'Musculocutaneous nerve (C5, C6), with a small radial nerve branch.',
    text: 'Lies underneath biceps and does most of the actual elbow bending. Because it inserts on the ulna, which cannot rotate, its pull is the same whatever the palm is doing.' },
  { id: 'triceps', name: 'Triceps brachii', group: 'arm',
    strands: [{ pts: [['humerus', 1.0, -0.5, -2.0], ['humerus', 12, 0, -3.3], ['humerus', 24, 0, -2.9], ['humerus', 29, 0, -1.8], ['forearm', -1.2, -1.3, -1.4]],
                r: [[0, 0.5], [0.35, 1.7], [0.7, 1.3], [0.9, 0.5], [1, 0.35]] }],
    origin: 'Long head: infraglenoid tubercle of the scapula. Lateral and medial heads: posterior humerus.', insertion: 'Olecranon of the ulna.',
    action: 'Extends the elbow; the long head also helps extend the shoulder.', nerve: 'Radial nerve (C6–C8).',
    text: 'The only muscle on the back of the upper arm and the only elbow extensor of any strength — pushing, pressing and locking the arm straight all run through it.' },

  /* ----- forearm flexors (anterior compartment) ----- */
  { id: 'pt', name: 'Pronator teres', group: 'flexors',
    strands: [{ pts: [['humerus', 29.4, -2.0, 0.9], ['forearm', 3, -1.0, 2.4], ['forearm', 7, 0.8, 2.2], ['forearm', 10.5, 2.6, 0.8]],
                r: [[0, 0.3], [0.4, 0.85], [0.8, 0.5], [1, 0.25]] }],
    origin: 'Medial epicondyle of the humerus and the coronoid process of the ulna.', insertion: 'Lateral surface of the radius, mid-shaft.',
    action: 'Pronates the forearm (turns the palm down) and helps flex the elbow.', nerve: 'Median nerve (C6, C7).',
    text: 'Runs diagonally across the front of the forearm just below the elbow. The median nerve passes between its two heads — a known site for nerve compression.' },
  { id: 'fcr', name: 'Flexor carpi radialis', group: 'flexors',
    strands: [{ pts: [['humerus', 29.6, -2.0, 0.6], ['forearm', 4, -0.6, 2.6], ['forearm', 12, 0.6, 2.4], ['forearm', 20, 1.2, 1.7], ['wrist', 0.6, 1.1, 1.0], ['index', 0.5, 0.1, 0.4]],
                r: [[0, 0.3], [0.25, 0.9], [0.55, 0.8], [0.75, 0.3], [1, 0.2]] }],
    origin: 'Medial epicondyle of the humerus (common flexor origin).', insertion: 'Base of the second metacarpal (and a slip to the third).',
    action: 'Flexes the wrist and tilts it toward the thumb (radial deviation).', nerve: 'Median nerve (C6, C7).',
    text: 'Its tendon is the prominent cord on the thumb side of the front of your wrist. The radial artery lies just outside it — which is where a pulse is taken.' },
  { id: 'pl', name: 'Palmaris longus', group: 'flexors',
    strands: [{ pts: [['humerus', 29.6, -2.1, 0.5], ['forearm', 5, -0.4, 3.0], ['forearm', 13, 0.2, 2.9], ['forearm', 21, 0.2, 2.1], ['wrist', 1.5, 0, 1.45], ['wrist', 3.2, 0, 1.5], ['middle', 2.5, 0, 1.2]],
                r: [[0, 0.25], [0.2, 0.55], [0.45, 0.4], [0.7, 0.18], [1, 0.12]] }],
    origin: 'Medial epicondyle of the humerus.', insertion: 'Palmar aponeurosis — the tough fascia under the skin of the palm.',
    action: 'Weakly flexes the wrist and tenses the skin of the palm.', nerve: 'Median nerve (C7, C8).',
    text: 'Missing in about one person in seven, with no loss of function. Touch your thumb to your little finger and flex the wrist: if a thin tendon pops up in the centre of the wrist, you have one. Surgeons harvest it as a spare tendon.' },
  { id: 'fcu', name: 'Flexor carpi ulnaris', group: 'flexors',
    strands: [{ pts: [['humerus', 29.7, -2.4, 0.2], ['forearm', 5, -2.6, 1.8], ['forearm', 13, -2.6, 1.6], ['forearm', 21, -2.2, 1.2], ['wrist', 0.7, -1.6, 0.7], ['little', 0.3, -0.2, 0.4]],
                r: [[0, 0.3], [0.3, 0.95], [0.6, 0.8], [0.8, 0.3], [1, 0.2]] }],
    origin: 'Medial epicondyle and the back edge of the ulna.', insertion: 'Pisiform, then via ligaments to the hamate and fifth metacarpal.',
    action: 'Flexes the wrist and tilts it toward the little finger (ulnar deviation).', nerve: 'Ulnar nerve (C7, C8).',
    text: 'Runs down the little-finger edge of the forearm. The ulnar nerve travels underneath it, between its two heads at the elbow and along its deep face all the way to the wrist.' },
  { id: 'fds', name: 'Flexor digitorum superficialis', group: 'flexors',
    strands: [
      { pts: [['humerus', 29.6, -2.0, 0.4], ['forearm', 5, -0.8, 2.0], ['forearm', 12, 0, 1.9], ['forearm', 19, 0.1, 1.5], ['forearm', 24, 0.2, 1.1]],
        r: [[0, 0.3], [0.3, 1.25], [0.65, 1.0], [1, 0.45]] },
      ...flexorTendons(24, 1.0, 'mp', 0.32, 0.6),
    ],
    origin: 'Medial epicondyle, coronoid process of the ulna, and the front of the radius.', insertion: 'Both sides of the middle phalanx of each finger — the tendon splits to let profundus through.',
    action: 'Flexes the middle joint (PIP) of each finger; also flexes the knuckles and wrist.', nerve: 'Median nerve (C7, C8, T1).',
    text: 'The big middle-layer flexor of the forearm, with four tendons that pass through the carpal tunnel. Each tendon splits at the finger to let the deeper profundus tendon pass through — a piece of design called the chiasm.' },
  { id: 'fdp', name: 'Flexor digitorum profundus', group: 'flexors',
    strands: [
      { pts: [['forearm', 2.5, -1.0, 0.9], ['forearm', 10, -0.8, 1.15], ['forearm', 18, -0.4, 0.9], ['forearm', 24, 0, 0.7]],
        r: [[0, 0.4], [0.35, 1.1], [0.7, 0.9], [1, 0.4]] },
      ...flexorTendons(24, 0.65, 'dp', 0.26, 0.6),
    ],
    origin: 'Front and inner surfaces of the upper three-quarters of the ulna and the interosseous membrane.', insertion: 'Base of the distal phalanx of each finger.',
    action: 'Flexes the fingertip joints (DIP), and with them every joint of the finger — the main grip muscle.', nerve: 'Index and middle fingers: anterior interosseous branch of the median nerve. Ring and little fingers: ulnar nerve (C8, T1).',
    text: 'The deepest and strongest finger flexor, lying directly on the ulna. A nerve split down its middle means a median nerve injury weakens the index and middle fingers while an ulnar injury weakens the ring and little — a clue clinicians use.' },
  { id: 'fpl', name: 'Flexor pollicis longus', group: 'flexors',
    strands: [{ pts: [['forearm', 8, 1.2, 1.2], ['forearm', 16, 1.5, 1.3], ['forearm', 23, 1.4, 1.0], ['wrist', 1.8, 1.6, 1.0], ['mc1', 0.5, 0, 0.55], ['mc1', 'len-0.3', 0, 0.45], ['pp1', 0.4, 0, 0.4], ['pp1', 'len-0.3', 0, 0.35], ['dp1', 0.5, 0, 0.26]],
                r: [[0, 0.3], [0.25, 0.85], [0.5, 0.5], [0.7, 0.25], [1, 0.16]] }],
    origin: 'Front of the radius and the interosseous membrane.', insertion: 'Base of the distal phalanx of the thumb.',
    action: 'Flexes the thumb tip, then the whole thumb.', nerve: 'Anterior interosseous branch of the median nerve (C8, T1).',
    text: 'The thumb’s own long flexor, and the only muscle that can bend the thumb tip. Its tendon has its own tunnel through the carpal tunnel on the thumb side.' },
  { id: 'pq', name: 'Pronator quadratus', group: 'flexors',
    strands: [{ pts: [['forearm', 21.5, -2.0, 0.6], ['forearm', 22.5, 0, 0.9], ['forearm', 23.5, 2.2, 0.6]],
                r: [[0, 0.35], [0.5, 0.6], [1, 0.35]] }],
    origin: 'Lower quarter of the front of the ulna.', insertion: 'Lower quarter of the front of the radius.',
    action: 'Pronates the forearm; the prime mover for slow pronation, with pronator teres joining in for speed and force.', nerve: 'Anterior interosseous branch of the median nerve (C8, T1).',
    text: 'A square sheet of muscle across the deepest layer of the wrist, running from bone to bone. It also holds the two forearm bones together where they take the load from the hand.' },

  /* ----- forearm extensors (posterior compartment) ----- */
  { id: 'br', name: 'Brachioradialis', group: 'extensors',
    strands: [{ pts: [['humerus', 23, 2.2, 0.3], ['humerus', 29, 3.0, 0.7], ['forearm', 4, 3.3, 1.2], ['forearm', 12, 3.0, 1.0], ['forearm', 20, 2.6, 0.5], ['forearm', 25, 2.4, 0.1]],
                r: [[0, 0.3], [0.3, 1.05], [0.55, 0.9], [0.8, 0.35], [1, 0.22]] }],
    origin: 'Lateral supracondylar ridge of the humerus.', insertion: 'Styloid process of the radius, just above the wrist.',
    action: 'Flexes the elbow, strongest with the forearm halfway between palm up and palm down.', nerve: 'Radial nerve (C5, C6).',
    text: 'The muscle that bulges along the thumb side of the forearm when you lift a mug. It is an elbow flexor that lives in the extensor compartment and takes the extensor nerve — an oddity that makes sense from its position rather than its job.' },
  { id: 'ecrl', name: 'Extensor carpi radialis longus', group: 'extensors',
    strands: [{ pts: [['humerus', 26, 2.4, -0.2], ['forearm', 3, 3.0, -1.0], ['forearm', 12, 2.4, -1.4], ['forearm', 22, 1.8, -1.2], ['wrist', 2, 1.4, -0.8], ['index', 0.5, 0.2, -0.5]],
                r: [[0, 0.3], [0.3, 0.8], [0.55, 0.5], [0.8, 0.25], [1, 0.18]] }],
    origin: 'Lateral supracondylar ridge of the humerus.', insertion: 'Base of the second metacarpal, dorsal side.',
    action: 'Extends the wrist and deviates it toward the thumb.', nerve: 'Radial nerve (C6, C7).',
    text: 'One of the two "wrist cockers". Every strong grip starts with the wrist extensors bracing the wrist so the finger flexors have something to pull against.' },
  { id: 'ecrb', name: 'Extensor carpi radialis brevis', group: 'extensors',
    strands: [{ pts: [['humerus', 29.6, 2.1, -0.4], ['forearm', 4, 2.4, -1.6], ['forearm', 12, 1.6, -1.8], ['forearm', 22, 1.1, -1.3], ['wrist', 2.5, 0.6, -0.8], ['middle', 0.5, 0, -0.5]],
                r: [[0, 0.3], [0.3, 0.8], [0.6, 0.45], [0.8, 0.25], [1, 0.18]] }],
    origin: 'Lateral epicondyle of the humerus (common extensor origin).', insertion: 'Base of the third metacarpal, dorsal side.',
    action: 'Extends the wrist.', nerve: 'Radial nerve, deep branch (C7, C8).',
    text: 'The muscle at the centre of "tennis elbow": its origin on the lateral epicondyle takes the strain whenever the wrist is held cocked against load.' },
  { id: 'ed', name: 'Extensor digitorum', group: 'extensors',
    strands: [
      { pts: [['humerus', 29.6, 1.9, -0.7], ['forearm', 5, 0.8, -2.4], ['forearm', 13, 0.2, -2.2], ['forearm', 20, 0, -1.6], ['forearm', 24, 0, -1.1]],
        r: [[0, 0.3], [0.3, 1.05], [0.65, 0.8], [1, 0.4]] },
      ...extensorTendons(24),
    ],
    origin: 'Lateral epicondyle of the humerus.', insertion: 'Extensor expansions over the backs of the fingers, reaching the middle and distal phalanges.',
    action: 'Extends the fingers at the knuckles and, through the expansion, the finger joints; helps extend the wrist.', nerve: 'Posterior interosseous branch of the radial nerve (C7, C8).',
    text: 'The four tendons you can see fanning across the back of the hand. Cross-links between them are why it is hard to lift the ring finger alone with the others held down.' },
  { id: 'edm', name: 'Extensor digiti minimi', group: 'extensors',
    strands: [{ pts: [['humerus', 29.7, 1.6, -0.9], ['forearm', 6, -0.8, -2.3], ['forearm', 14, -1.2, -2.0], ['forearm', 22, -1.4, -1.3], ['wrist', 2, -1.3, -0.85], ['little', 0.5, -0.1, -0.62], ['little', 'len-0.3', 0, -0.58], ['pp5', 'len-0.4', 0, -0.44]],
                r: [[0, 0.25], [0.3, 0.55], [0.6, 0.3], [1, 0.14]] }],
    origin: 'Lateral epicondyle of the humerus.', insertion: 'Extensor expansion of the little finger.',
    action: 'Extends the little finger independently of the others.', nerve: 'Posterior interosseous nerve (C7, C8).',
    text: 'A private extensor for the little finger, which is why you can raise it on its own — the gesture that reads as "fancy".' },
  { id: 'ecu', name: 'Extensor carpi ulnaris', group: 'extensors',
    strands: [{ pts: [['humerus', 29.8, 1.3, -1.1], ['forearm', 6, -1.8, -2.0], ['forearm', 14, -2.2, -1.7], ['forearm', 22, -2.2, -1.1], ['wrist', 1.2, -1.7, -0.6], ['little', 0.4, -0.1, -0.45]],
                r: [[0, 0.3], [0.3, 0.75], [0.6, 0.5], [0.8, 0.25], [1, 0.18]] }],
    origin: 'Lateral epicondyle and the back edge of the ulna.', insertion: 'Base of the fifth metacarpal, dorsal side.',
    action: 'Extends the wrist and deviates it toward the little finger.', nerve: 'Posterior interosseous nerve (C7, C8).',
    text: 'Runs along the back of the ulna. Its tendon sits in a groove at the end of the ulna and can snap out of it in wrist-twisting sports.' },
  { id: 'supinator', name: 'Supinator', group: 'extensors',
    strands: [{ pts: [['humerus', 29.4, 2.4, -0.6], ['forearm', 2, 1.6, -1.6], ['forearm', 4.5, 2.7, -0.2], ['forearm', 6.5, 2.3, 1.2]],
                r: [[0, 0.3], [0.5, 0.7], [1, 0.3]] }],
    origin: 'Lateral epicondyle, the ligaments of the elbow, and the supinator crest of the ulna.', insertion: 'Upper third of the radius, wrapping around it.',
    action: 'Supinates the forearm — turns the palm up — especially when the elbow is straight.', nerve: 'Deep branch of the radial nerve (C6, C7).',
    text: 'A short muscle wrapped around the top of the radius like a cuff. The deep radial nerve passes straight through it, which is where it can get trapped.' },
  { id: 'apl', name: 'Abductor pollicis longus', group: 'extensors',
    strands: [{ pts: [['forearm', 10, -0.5, -1.6], ['forearm', 16, 1.2, -1.4], ['forearm', 22, 2.4, -0.6], ['wrist', 1.5, 2.4, 0.2], ['mc1', 0.4, 0.15, 0]],
                r: [[0, 0.3], [0.35, 0.7], [0.7, 0.3], [1, 0.18]] }],
    origin: 'Backs of the ulna and radius and the interosseous membrane.', insertion: 'Base of the first metacarpal.',
    action: 'Pulls the thumb away from the hand (abduction) and extends it at its base.', nerve: 'Posterior interosseous nerve (C7, C8).',
    text: 'One of three "outcropping" muscles that emerge from between the finger extensors and run to the thumb. With extensor pollicis brevis it forms the front edge of the anatomical snuffbox.' },
  { id: 'epb', name: 'Extensor pollicis brevis', group: 'extensors',
    strands: [{ pts: [['forearm', 13, 0.6, -1.7], ['forearm', 19, 1.6, -1.4], ['forearm', 24, 2.4, -0.6], ['wrist', 2.2, 2.4, 0], ['mc1', 'len*0.5', 0.2, -0.32], ['pp1', 0.4, 0, -0.36]],
                r: [[0, 0.25], [0.35, 0.5], [0.7, 0.22], [1, 0.14]] }],
    origin: 'Back of the radius and the interosseous membrane.', insertion: 'Base of the proximal phalanx of the thumb.',
    action: 'Extends the thumb at the knuckle.', nerve: 'Posterior interosseous nerve (C7, C8).',
    text: 'The short thumb extensor, running with abductor pollicis longus in the same tendon sheath at the wrist — the sheath inflamed in de Quervain’s tenosynovitis.' },
  { id: 'epl', name: 'Extensor pollicis longus', group: 'extensors',
    strands: [{ pts: [['forearm', 11, -1.0, -1.8], ['forearm', 18, -0.2, -1.9], ['forearm', 24, 1.0, -1.25], ['wrist', 2.4, 1.9, -0.5], ['mc1', 'len*0.5', 0, -0.42], ['pp1', 'len*0.5', 0, -0.36], ['dp1', 0.45, 0, -0.26]],
                r: [[0, 0.25], [0.35, 0.55], [0.7, 0.2], [1, 0.13]] }],
    origin: 'Back of the ulna and the interosseous membrane.', insertion: 'Base of the distal phalanx of the thumb.',
    action: 'Extends the thumb tip and lifts the thumb back away from the palm.', nerve: 'Posterior interosseous nerve (C7, C8).',
    text: 'Its tendon turns a corner around a bump on the end of the radius (Lister’s tubercle) and then forms the back edge of the anatomical snuffbox. It is what lets you give a "thumbs up".' },
  { id: 'ei', name: 'Extensor indicis', group: 'extensors',
    strands: [{ pts: [['forearm', 14, -0.6, -1.7], ['forearm', 22, 0.4, -1.4], ['wrist', 2.5, 1.0, -0.85], ['index', 0.5, 0, -0.66], ['index', 'len-0.3', 0, -0.6], ['pp2', 0.6, 0, -0.47]],
                r: [[0, 0.25], [0.35, 0.5], [0.7, 0.2], [1, 0.13]] }],
    origin: 'Back of the ulna and the interosseous membrane.', insertion: 'Extensor expansion of the index finger.',
    action: 'Extends the index finger on its own.', nerve: 'Posterior interosseous nerve (C7, C8).',
    text: 'The index finger’s private extensor — the reason you can point with a straight index finger while the others are curled.' },

  /* ----- intrinsic hand muscles ----- */
  { id: 'apb', name: 'Abductor pollicis brevis', group: 'hand',
    strands: [{ pts: [['wrist', 2.2, 1.7, 1.0], ['mc1', 'len*0.5', 0.9, 0.5], ['pp1', 0.3, 0.5, 0.2]], r: [[0, 0.3], [0.5, 0.55], [1, 0.2]] }],
    origin: 'Flexor retinaculum, scaphoid and trapezium.', insertion: 'Outer side of the base of the proximal phalanx of the thumb.',
    action: 'Lifts the thumb away from the palm (palmar abduction) — the first move in reaching for an object.', nerve: 'Recurrent branch of the median nerve (C8, T1).',
    text: 'The most superficial muscle of the thumb pad (thenar eminence). Wasting of this muscle is the classic sign of long-standing carpal tunnel syndrome.' },
  { id: 'fpb', name: 'Flexor pollicis brevis', group: 'hand',
    strands: [{ pts: [['wrist', 2.6, 1.4, 1.1], ['mc1', 'len*0.6', 0.2, 0.85], ['pp1', 0.3, -0.3, 0.3]], r: [[0, 0.3], [0.5, 0.55], [1, 0.2]] }],
    origin: 'Flexor retinaculum and trapezium.', insertion: 'Base of the proximal phalanx of the thumb.',
    action: 'Flexes the thumb at its knuckle and helps bring it across the palm.', nerve: 'Superficial head: median nerve. Deep head: ulnar nerve (C8, T1).',
    text: 'Sits beside the abductor in the thumb pad and shares its insertion. It has two heads with two different nerves, so it rarely fails completely.' },
  { id: 'opp', name: 'Opponens pollicis', group: 'hand',
    strands: [{ pts: [['wrist', 2.5, 1.6, 0.8], ['mc1', 'len*0.4', 0.7, 0.3], ['mc1', 'len*0.85', 0.6, 0.2]], r: [[0, 0.3], [0.5, 0.5], [1, 0.25]] }],
    origin: 'Flexor retinaculum and trapezium.', insertion: 'The whole outer border of the first metacarpal.',
    action: 'Rotates the thumb so its pad faces the fingers — opposition.', nerve: 'Recurrent branch of the median nerve (C8, T1).',
    text: 'Hidden under the abductor, and the muscle that makes a hand a hand: it turns the thumb to meet the fingertips. Losing it (median nerve palsy) leaves an "ape hand" that cannot pinch.' },
  { id: 'adp', name: 'Adductor pollicis', group: 'hand',
    strands: [{ pts: [['middle', 2.0, 0, 0.55], ['index', 3.6, 0.4, 0.95], ['mc1', 'len*0.9', -0.6, 0.5], ['pp1', 0.3, -0.5, 0.3]], r: [[0, 0.35], [0.4, 0.65], [1, 0.22]] }],
    origin: 'Oblique head: capitate and the bases of the second and third metacarpals. Transverse head: shaft of the third metacarpal.', insertion: 'Inner side of the base of the proximal phalanx of the thumb.',
    action: 'Pulls the thumb in against the index finger — the key pinch, as when holding a sheet of paper.', nerve: 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'A fan of muscle in the web between thumb and index. Weakness here (ulnar nerve) shows as Froment’s sign: the thumb tip bends to compensate when you try to grip paper between thumb and finger.' },
  { id: 'adm', name: 'Abductor digiti minimi', group: 'hand',
    strands: [{ pts: [['wrist', 0.9, -1.75, 0.6], ['little', 'len*0.5', -0.75, 0.3], ['pp5', 0.3, -0.4, 0.1]], r: [[0, 0.3], [0.5, 0.5], [1, 0.2]] }],
    origin: 'Pisiform and the tendon of flexor carpi ulnaris.', insertion: 'Inner side of the base of the proximal phalanx of the little finger.',
    action: 'Spreads the little finger away from the ring finger.', nerve: 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'The outermost muscle of the little-finger pad (hypothenar eminence) — the fleshy edge of the hand you would use for a karate chop.' },
  { id: 'fdm', name: 'Flexor digiti minimi brevis', group: 'hand',
    strands: [{ pts: [['wrist', 2.6, -1.3, 0.65], ['little', 'len*0.5', -0.2, 0.65], ['pp5', 0.3, -0.2, 0.3]], r: [[0, 0.25], [0.5, 0.45], [1, 0.18]] }],
    origin: 'Hook of the hamate and the flexor retinaculum.', insertion: 'Base of the proximal phalanx of the little finger.',
    action: 'Flexes the little finger at its knuckle.', nerve: 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'Lies beside the abductor in the hypothenar pad and shares its insertion — a mirror of the thumb’s short flexor and abductor pair.' },
  { id: 'odm', name: 'Opponens digiti minimi', group: 'hand',
    strands: [{ pts: [['wrist', 2.7, -1.4, 0.4], ['little', 'len*0.5', -0.6, 0.0], ['little', 'len*0.9', -0.5, 0.0]], r: [[0, 0.3], [0.5, 0.45], [1, 0.22]] }],
    origin: 'Hook of the hamate and the flexor retinaculum.', insertion: 'Inner border of the fifth metacarpal.',
    action: 'Draws the little-finger side of the palm forward to deepen the cup of the hand.', nerve: 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'The deepest hypothenar muscle. It cannot truly oppose the way the thumb does, but it rotates the fifth metacarpal enough to let the little finger meet the thumb.' },
  ...[2, 3, 4, 5].map(i => ({
    id: `lumb${i - 1}`, name: `Lumbrical ${['I', 'II', 'III', 'IV'][i - 2]} (${fingerFrames[i]} finger)`, group: 'hand',
    strands: [{ pts: [[fingerFrames[i], 2.0, 0.0, 0.75], [fingerFrames[i], 'len-0.5', 0.4, 0.5], [`pp${i}`, 1.1, 0.38, -0.05]], r: [[0, 0.22], [0.5, 0.32], [1, 0.14]] }],
    origin: 'The tendon of flexor digitorum profundus in the palm.', insertion: 'The radial side of the extensor expansion on the back of the finger.',
    action: 'Flexes the knuckle while straightening the finger joints — the "writing" or "table-top" position.', nerve: i <= 3 ? 'Median nerve (C8, T1).' : 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'A worm-shaped muscle that starts on a tendon instead of a bone, and crosses from the palm side of the finger to its back. It links the flexor and extensor systems, which is what lets you hold a card flat between straight fingers.',
  })),
  ...[
    { n: 1, frame: 'index',  y: 0.5,  pp: 'pp2', side: 0.35 },
    { n: 2, frame: 'middle', y: 0.45, pp: 'pp3', side: 0.35 },
    { n: 3, frame: 'middle', y: -0.45, pp: 'pp3', side: -0.35 },
    { n: 4, frame: 'ring',   y: -0.45, pp: 'pp4', side: -0.35 },
  ].map(d => ({
    id: `di${d.n}`, name: `Dorsal interosseous ${['I', 'II', 'III', 'IV'][d.n - 1]}`, group: 'hand',
    strands: [{ pts: [[d.frame, 1.2, d.y, -0.1], [d.frame, 'len-0.6', d.y * 0.85, -0.25], [d.pp, 0.6, d.side, -0.27]], r: [[0, 0.3], [0.45, 0.48], [1, 0.16]] }],
    origin: 'The facing sides of two adjacent metacarpals.', insertion: 'Base of the proximal phalanx and the extensor expansion.',
    action: 'Spreads the fingers apart (abduction, away from the middle finger); also flexes the knuckle and extends the finger joints. Mnemonic: DAB — Dorsal ABduct.', nerve: 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'Four muscles filling the spaces between the metacarpals on the back of the hand. The first one is the bulge you can see between thumb and index when you press them together.',
  })),
  ...[
    { n: 1, frame: 'index',  y: -0.4, pp: 'pp2', side: -0.3 },
    { n: 2, frame: 'ring',   y: 0.4,  pp: 'pp4', side: 0.3 },
    { n: 3, frame: 'little', y: 0.4,  pp: 'pp5', side: 0.3 },
  ].map(d => ({
    id: `pi${d.n}`, name: `Palmar interosseous ${['I', 'II', 'III'][d.n - 1]}`, group: 'hand',
    strands: [{ pts: [[d.frame, 1.5, d.y, 0.35], [d.frame, 'len-0.6', d.y * 0.9, 0.3], [d.pp, 0.6, d.side, 0.1]], r: [[0, 0.25], [0.45, 0.36], [1, 0.14]] }],
    origin: 'The palmar side of the metacarpal of its own finger (index, ring and little).', insertion: 'Base of the proximal phalanx and the extensor expansion of the same finger.',
    action: 'Pulls the fingers together toward the middle finger (adduction). Mnemonic: PAD — Palmar ADduct.', nerve: 'Deep branch of the ulnar nerve (C8, T1).',
    text: 'Three slim muscles on the palm side of the metacarpals. Holding the fingers tightly together — as in a salute — is their work; the middle finger has none because it is the axis the others move toward.',
  })),
];

export const MUSCLE_GROUPS = {
  arm:       { label: 'Upper arm',        color: 0x9c2a34 },
  flexors:   { label: 'Forearm flexors',  color: 0xa8303a },
  extensors: { label: 'Forearm extensors', color: 0x8f2b3d },
  hand:      { label: 'Hand intrinsics',  color: 0xb2404a },
};

/* ------------------------------------------------------------ nerves */
export const NERVES = [
  { id: 'median', name: 'Median nerve', roots: 'C5–T1, from the lateral and medial cords of the brachial plexus',
    strands: [
      { pts: [['humerus', 1, -1.4, 1.2], ['humerus', 12, -1.6, 1.4], ['humerus', 24, -1.4, 1.6], ['humerus', 29.5, -1.0, 1.6], ['forearm', 3, -0.4, 1.9], ['forearm', 8, 0.2, 1.45], ['forearm', 16, 0.2, 1.25], ['forearm', 23, 0.3, 1.1], ['wrist', 1.4, 0.2, 0.9], ['wrist', 3.2, 0.3, 1.0]],
        r: [[0, 0.3], [0.75, 0.26], [1, 0.22]] },
      { label: 'recurrent (thenar) branch', pts: [['wrist', 3.2, 0.3, 1.0], ['wrist', 3.1, 1.4, 1.25], ['mc1', 1.0, 0.5, 0.65]], r: [[0, 0.12], [1, 0.08]] },
      { label: 'anterior interosseous branch', pts: [['forearm', 8, 0.2, 1.45], ['forearm', 14, -0.2, 0.62], ['forearm', 21, -0.2, 0.5]], r: [[0, 0.14], [1, 0.08]] },
      { label: 'digital branch, thumb', pts: [['wrist', 3.2, 0.3, 1.0], ['mc1', 'len*0.5', -0.3, 0.75], ['pp1', 'len-0.3', 0, 0.55], ['dp1', 0.6, 0, 0.35]], r: [[0, 0.13], [1, 0.07]] },
      { label: 'digital branch, index', pts: [['wrist', 3.2, 0.3, 1.0], ['index', 2, 0.2, 0.85], ['pp2', 2, 0.2, 0.55], ['dp2', 0.6, 0.1, 0.3]], r: [[0, 0.13], [1, 0.07]] },
      { label: 'digital branch, middle', pts: [['wrist', 3.2, 0.3, 1.0], ['middle', 2, 0, 0.85], ['pp3', 2, 0, 0.55], ['dp3', 0.6, 0, 0.3]], r: [[0, 0.13], [1, 0.07]] },
      { label: 'digital branch, ring (radial half)', pts: [['wrist', 3.2, 0.3, 1.0], ['ring', 2, 0.3, 0.85], ['pp4', 2, 0.3, 0.55], ['dp4', 0.6, 0.2, 0.3]], r: [[0, 0.12], [1, 0.07]] },
    ],
    course: 'Down the inner side of the upper arm beside the brachial artery, through the front of the elbow, between the two heads of pronator teres, then down the middle of the forearm under flexor digitorum superficialis and through the carpal tunnel into the palm.',
    motor: 'Most of the forearm flexors and pronators (all but flexor carpi ulnaris and half of profundus), the thumb pad muscles, and the first two lumbricals.',
    sensory: 'Palm side of the thumb, index and middle fingers and half the ring finger, plus their fingertips round onto the nail beds.',
    text: 'The nerve of precision grip. Carpal tunnel syndrome is this nerve being squeezed under the wrist ligament: numb thumb, index and middle fingers at night, then a wasting thumb pad. Test it by touching thumb to little finger and making an "OK" sign.' },
  { id: 'ulnar', name: 'Ulnar nerve', roots: 'C8–T1, from the medial cord of the brachial plexus',
    strands: [
      { pts: [['humerus', 1, -1.8, 0.8], ['humerus', 12, -2.2, 0.3], ['humerus', 24, -2.6, -0.5], ['humerus', 29.6, -2.9, -0.6], ['forearm', 3, -2.6, 0.6], ['forearm', 10, -2.6, 1.2], ['forearm', 18, -2.3, 1.3], ['forearm', 24, -1.9, 1.2], ['wrist', 1.2, -1.4, 1.2], ['wrist', 2.8, -1.0, 1.1]],
        r: [[0, 0.28], [0.8, 0.24], [1, 0.2]] },
      { label: 'deep (motor) branch', pts: [['wrist', 2.8, -1.0, 1.1], ['ring', 1.5, -0.2, 0.65], ['middle', 2.5, 0, 0.55], ['index', 3.0, 0.4, 0.75]], r: [[0, 0.14], [1, 0.08]] },
      { label: 'digital branch, little', pts: [['wrist', 2.8, -1.0, 1.1], ['little', 2, -0.2, 0.75], ['pp5', 1.5, 0, 0.5], ['dp5', 0.5, 0, 0.3]], r: [[0, 0.13], [1, 0.07]] },
      { label: 'digital branch, ring (ulnar half)', pts: [['wrist', 2.8, -1.0, 1.1], ['ring', 2, -0.3, 0.85], ['pp4', 2, -0.3, 0.55], ['dp4', 0.6, -0.2, 0.3]], r: [[0, 0.12], [1, 0.07]] },
      { label: 'dorsal cutaneous branch', pts: [['forearm', 20, -2.3, 0.9], ['forearm', 24, -2.5, -0.8], ['wrist', 2, -1.6, -0.85], ['little', 1.5, -0.3, -0.7]], r: [[0, 0.12], [1, 0.07]] },
    ],
    course: 'Down the inner side of the upper arm, behind the medial epicondyle of the elbow (the cubital tunnel), between the heads of flexor carpi ulnaris, along the little-finger side of the forearm under that muscle, then over the wrist ligament through Guyon’s canal into the palm.',
    motor: 'Flexor carpi ulnaris, the ring and little finger half of flexor digitorum profundus, and nearly all the small muscles of the hand: the hypothenar group, all the interossei, the third and fourth lumbricals and adductor pollicis.',
    sensory: 'Little finger and the ulnar half of the ring finger, front and back.',
    text: 'The nerve of grip strength and fine finger control — and the "funny bone", where it lies just under the skin behind the elbow. Damage gives a claw hand: the ring and little fingers curl because the small muscles that balance them have gone.' },
  { id: 'radial', name: 'Radial nerve', roots: 'C5–T1, from the posterior cord of the brachial plexus',
    strands: [
      { pts: [['humerus', 1, -1.0, -0.6], ['humerus', 10, -0.6, -2.7], ['humerus', 18, 1.4, -2.5], ['humerus', 25, 2.6, -0.6], ['humerus', 29.5, 2.6, 0.8], ['forearm', 2.5, 2.6, 1.2]],
        r: [[0, 0.3], [1, 0.22]] },
      { label: 'superficial (sensory) branch', pts: [['forearm', 2.5, 2.6, 1.2], ['forearm', 10, 3.0, 0.6], ['forearm', 18, 2.8, -0.2], ['forearm', 24, 2.4, -0.95], ['wrist', 2, 1.8, -0.95], ['index', 1.5, 0.5, -0.75], ['pp2', 1.5, 0.3, -0.5]], r: [[0, 0.16], [1, 0.08]] },
      { label: 'superficial branch, thumb', pts: [['wrist', 2, 1.8, -0.95], ['mc1', 'len*0.5', 0.3, -0.5], ['pp1', 0.8, 0.2, -0.4]], r: [[0, 0.1], [1, 0.07]] },
      { label: 'deep branch / posterior interosseous', pts: [['forearm', 2.5, 2.6, 1.2], ['forearm', 5, 2.7, -0.4], ['forearm', 8, 1.2, -1.9], ['forearm', 16, 0.2, -1.7], ['forearm', 22, 0, -1.4]], r: [[0, 0.16], [1, 0.08]] },
    ],
    course: 'Spirals around the back of the humerus in the radial groove, comes forward on the outer side of the elbow between brachialis and brachioradialis, and splits: the superficial branch runs under brachioradialis to the back of the hand, the deep branch pierces supinator and continues as the posterior interosseous nerve down the back of the forearm.',
    motor: 'Triceps, brachioradialis, supinator and every wrist, finger and thumb extensor.',
    sensory: 'Back of the arm and forearm, and the back of the hand on the thumb side — thumb, index and middle finger up to the last joint.',
    text: 'The nerve that lifts the hand. A fracture of the humeral shaft, or sleeping with the arm over a chair back ("Saturday night palsy"), gives wrist drop: the fingers and wrist hang because nothing can extend them.' },
  { id: 'mcn', name: 'Musculocutaneous nerve', roots: 'C5–C7, from the lateral cord of the brachial plexus',
    strands: [{ pts: [['humerus', 1, 0.2, 1.6], ['humerus', 10, 0.6, 2.6], ['humerus', 20, 0.9, 2.9], ['humerus', 28, 2.0, 2.2], ['forearm', 4, 3.2, 1.6], ['forearm', 12, 3.6, 0.8]], r: [[0, 0.22], [0.6, 0.16], [1, 0.08]] }],
    course: 'Pierces coracobrachialis, runs between biceps and brachialis, and emerges at the outer side of the elbow as the lateral cutaneous nerve of the forearm.',
    motor: 'Biceps brachii, brachialis and coracobrachialis — the front of the upper arm.',
    sensory: 'The outer (thumb-side) surface of the forearm.',
    text: 'The elbow flexor nerve. Small next to the other three, but without it the arm cannot bend at the elbow with any force, nor turn the palm up against resistance.' },
];

/* ------------------------------------------------------------ presets
   Named hand positions. Values are degrees, or a 0–1 "curl" for a whole
   digit; anything not named stays where it is. */
export const PRESETS = {
  open:    { label: 'Open hand',  curl: { index: 0, middle: 0, ring: 0, little: 0, thumb: 0 }, spread: 1, thumbAbd: 0 },
  relaxed: { label: 'Relaxed',    curl: { index: 0.22, middle: 0.28, ring: 0.32, little: 0.35, thumb: 0.25 }, spread: 0.4, thumbAbd: 5, wrist: 8 },
  fist:    { label: 'Fist',       curl: { index: 1, middle: 1, ring: 1, little: 1, thumb: 1 }, spread: 0, thumbAbd: -8 },
  point:   { label: 'Point',      curl: { index: 0, middle: 1, ring: 1, little: 1, thumb: 0.65 }, spread: 0, thumbAbd: 0 },
  pinch:   { label: 'Pinch',      curl: { index: 0.6, middle: 0.9, ring: 0.95, little: 1, thumb: 0.45 }, spread: 0.1, thumbAbd: 22 },
  thumbsup:{ label: 'Thumbs up',  curl: { index: 1, middle: 1, ring: 1, little: 1, thumb: 0 }, spread: 0, thumbAbd: 30, wrist: -15 },
  peace:   { label: 'Peace',      curl: { index: 0, middle: 0, ring: 1, little: 1, thumb: 0.8 }, spread: 1.6, thumbAbd: -5 },
  ok:      { label: 'OK sign',    curl: { index: 0.7, middle: 0.05, ring: 0.05, little: 0.05, thumb: 0.55 }, spread: 1.2, thumbAbd: 18 },
};
