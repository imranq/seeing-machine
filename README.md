# The Seeing Machine

Single-page three.js app with three linked experiments on one anatomically scaled model (millimetres):

1. **Focus**: meridional ray tracing through a Le Grand schematic eye; accommodation, age (Hofstetter amplitude), axial length, pupil and spectacles.
2. **Movement**: six extraocular muscles on a pulley/string model (Robinson 1975, Demer pulleys), a Listing's-law inverse controller, forward dynamics, main-sequence saccades, pursuit, vergence and CN III/IV/VI palsies with a red-glass diplopia view.
3. **Wiring**: about 850 retinotopic axons that follow Jansonius et al. (2009) nerve-fibre trajectories to the disc, then run through the chiasm (nasal fibres cross), LGN layers, Meyer's loop and the parietal radiation to a log-polar V1 map. Lesions cut the axons that pass through them, and the visual fields are computed from the axons that survive.

The previous long-form essay is in `article.html`.

Live: https://seeing-machine.pages.dev

Static site, no build step: `npm start` → http://localhost:5174. Deploy with `npm run deploy` (Cloudflare Pages).
