# three.js (vendored)

**Version 0.185.1.** MIT licensed - see `LICENSE`.

The games under `public/game/` are plain static files with no build step, so
three.js is committed here rather than installed with npm. GitHub Pages serves
this folder directly, which is the whole deploy: nothing bundles these pages, so
a `node_modules/` copy would never reach the browser.

## What is here

```
build/three.module.min.js    the library  (360 KB)
build/three.core.min.js      its core     (380 KB)  - three.module.min.js
                                                      imports this by name, so
                                                      the two must stay siblings
addons/controls/OrbitControls.js        orbit camera
addons/controls/PointerLockControls.js  first-person camera
addons/loaders/GLTFLoader.js            .glb / .gltf models
addons/utils/BufferGeometryUtils.js     needed by GLTFLoader
addons/utils/SkeletonUtils.js           needed by GLTFLoader; clones rigged meshes
addons/libs/stats.module.js             frame-rate meter
```

That is a curated slice. The full `examples/jsm` is 8.7 MB, most of which no game
here needs; see "Adding an addon" below to pull in more.

## Using it

Addons import bare specifiers (`three`, `three/addons/...`), so a page needs an
import map before any module script. Paths are absolute, so this works from any
folder depth:

```html
<script type="importmap">
{
  "imports": {
    "three": "/public/vendor/three/build/three.module.min.js",
    "three/addons/": "/public/vendor/three/addons/"
  }
}
</script>

<script type="module">
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
</script>
```

The trailing slash on the `three/addons/` key is required - import maps only
treat a key as a prefix when it ends in one.

`public/game/three-starter/index.html` is a working copy of the above.

## Adding an addon

Addons live in the npm package under `examples/jsm/`. Copy the file into
`addons/` at the same relative path, then follow its relative imports and copy
those too, or it will fail at runtime with a 404:

```bash
npm pack three@0.185.1
tar -xzf three-0.185.1.tgz
grep -oE "from '[.][^']*'" package/examples/jsm/<the-addon>.js
```

## Upgrading

Replace both files in `build/` and re-copy every file in `addons/` from the same
release - addons are only guaranteed to match the exact version they shipped
with. Then update the version at the top of this file.
