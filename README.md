# robokyle

Pages repo containing live code for robokyle.org: a nonprofit ability solutions start-up.

## Publishing

GitHub Pages serves this repo's root, so the built app is committed like any
other file and pushing is the deploy:

```bash
./deploy.sh                 # build, commit app.html/404.html/public/assets, push
./deploy.sh "message"       # same, with your own commit message
```

It touches only the build output; anything else you have edited stays
uncommitted for you to handle. Pages redeploys within about a minute.

To do it by hand:

```bash
npm --prefix frontend_react run build
git add app.html 404.html public/assets/react
git commit -m "Rebuild site"
git push
```

The API is not part of this: it runs on your own machine behind
`api.robokyle.org`, and the page reaches it at run time.

## Credits

Music in Fly Game:

- "Morning" by Kevin MacLeod (incompetech.com)
- "Evening" by Kevin MacLeod (incompetech.com)

Both licensed under Creative Commons: By Attribution 4.0
<https://creativecommons.org/licenses/by/4.0/>

The same credit appears on the game's own settings screen, which is what
the licence asks for: somewhere people can actually find it.

Cat sounds in Fly Game are public domain (CC0) from opengameart.org,
which asks for nothing in return.
