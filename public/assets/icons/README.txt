RS chrome icon assets (RuneScape Profile Spec section 6).

Drop SVG files (or 64x64 PNG minimum) here with these exact names and they
appear across the site automatically: skills panel, inventory fallbacks,
bank tabs, tool shelf, level-up toast. Until a file exists a fallback tile
renders (colored initial for skills, a line wrench for tools), so nothing
breaks while the set is incomplete. Single-weight line-or-flat style,
readable at 26px on the dark theme.

Skill icons (9):
  skill-mech.svg        (Mechanical)
  skill-fab.svg        (Fabrication)
  skill-elec.svg        (Electronics)
  skill-soft.svg        (Software)
  skill-sys.svg        (Systems)
  skill-abil.svg        (Ability)
  skill-docs.svg        (Documentation)
  skill-dsgn.svg        (Design)
  skill-comm.svg        (Community)

Tool icons (one per equipment vocabulary item):
  tool-3d-printer.svg
  tool-soldering-iron.svg
  tool-hot-glue-gun.svg
  tool-basic-hand-tools.svg
  tool-drill.svg
  tool-sewing-kit.svg
  tool-computer.svg
  tool-smartphone.svg
  tool-software-experience.svg
  tool-electronics-experience.svg

New vocabulary items enter with the generic wrench until an icon is
contributed. Nothing else goes here: no textures, borders or backgrounds,
all chrome is CSS.
