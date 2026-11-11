// Presets. The prompt text is always English; pt/en are interface labels.
export interface Genre{pt:string;en:string;word:string;perf:string}
export interface Dialogue{pt:string;en:string;line:string}
export interface StylePreset{pt:string;en:string;style:string;surface:string;physics:string;lock:string}
export interface LightPreset{pt:string;en:string;lighting:string;grade:string;lock:string}
export const GENRES:Record<string,Genre>={
  comedy:{pt:"Comédia",en:"Comedy",word:"comedy",perf:"Exaggerated, readable cartoon acting.\nBig, clear facial expressions.\nSnappy comedic timing with a pause before each punch."},
  heartfelt:{pt:"Emotivo",en:"Heartfelt",word:"heartfelt",perf:"Gentle, sincere acting. Small gestures carry the emotion.\nEyes and posture tell the story.\nUnhurried timing; let each beat breathe."},
  suspense:{pt:"Suspense",en:"Suspense",word:"suspense",perf:"Controlled, tense acting. Stillness before every move.\nEyes dart; breath is held.\nSlow build, sharp release."},
  action:{pt:"Ação",en:"Action",word:"action",perf:"Bold, athletic acting with clear silhouettes.\nStrong anticipation before every move, clean follow-through after.\nFast timing with one clear beat per shot."},
  wonder:{pt:"Encantamento",en:"Wonder",word:"wonder-filled",perf:"Wide-eyed, curious acting.\nSlow reactions of awe; small delighted gestures.\nCalm timing with room to look around."}
};
export const DIALOGUE:Record<string,Dialogue>={
  none:{pt:"Sem diálogo",en:"No dialogue",line:"Pure visual storytelling. NO dialogue."},
  sfx:{pt:"Só sons e reações",en:"Sounds and reactions only",line:"NO spoken words. Only grunts, gasps, laughs and sound effects."},
  lines:{pt:"Com falas (escreva na ação)",en:"Spoken lines (write them in the action)",line:"Short spoken lines only where written in ACTION. No other speech."}
};
export const STYLES:Record<string,StylePreset>={
  painterly:{pt:"3D pictórico pintado à mão",en:"Painterly hand-painted 3D",
    style:"PAINTERLY STYLIZED 3D with a HAND-PAINTED 2D FINISH.\nLooks like a modern animated feature painted by hand.\nSoft painted gradients. Simple, clean graphic shapes. Minimal fine texture.\nCharacters are CARICATURED: bold proportions, big expressive faces.\nBackgrounds simplified and hazy, with soft atmospheric depth.\nSoft painted shading, NOT plastic, NOT glossy CG, NOT photoreal.",
    surface:"Walls, ground and props painted with soft, simplified brushwork.\nFoliage and fabric as brushy shapes, not fine detail.\nPainterly finish on every surface, NOT photoreal.",
    physics:"Cartoon physics with real weight.\nSlight squash on impact and stretch on acceleration.\nLight objects drift and scatter in the wake of fast movement.",
    lock:"Painterly stylized 3D with a hand-painted 2D finish in EVERY frame."},
  clay:{pt:"Massinha stop-motion",en:"Claymation stop-motion",
    style:"STOP-MOTION CLAYMATION look.\nHandmade clay characters with visible thumbprints and soft tool marks.\nMiniature physical sets built from clay, card and wire.\nAnimated on twos for a slightly stepped, handmade rhythm.\nShallow depth of field, like macro photography of a tabletop set.\nNOT smooth CG, NOT photoreal humans.",
    surface:"Matte clay with fingerprints and tiny seams.\nSets show real miniature materials: painted card, felt, wire, wood.\nSmall imperfections on every surface.",
    physics:"Tabletop stop-motion physics.\nMovement is slightly stepped, with weight and firm contact on the ground.\nSmoke, water and dust are made of cotton, gel and clay.",
    lock:"Handmade claymation stop-motion look in EVERY frame."},
  cel:{pt:"2D desenhado à mão",en:"Hand-drawn 2D cel",
    style:"HAND-DRAWN 2D CEL ANIMATION.\nClean, confident ink outlines with flat color fills and one layer of shadow.\nBackgrounds painted in gouache with visible brush texture.\nCharacters have clear silhouettes and expressive, simplified faces.\nNOT 3D, NOT vector-flat, NOT photoreal.",
    surface:"Flat color with a single soft shadow tone on characters.\nGouache backgrounds with dry-brush texture and soft edges.\nHighlights as simple painted shapes.",
    physics:"Classic hand-drawn physics.\nClear anticipation, follow-through and overlapping action.\nHair, cloth and tails trail behind the movement.",
    lock:"Hand-drawn 2D cel animation with gouache backgrounds in EVERY frame."},
  paper:{pt:"Recorte de papel",en:"Paper cut-out",
    style:"PAPER CUT-OUT STOP-MOTION.\nCharacters and sets built from layered cut paper and card.\nVisible paper grain, cut edges and small drop shadows between layers.\nLimited, jointed movement like hinged paper puppets.\nNOT 3D CG, NOT photoreal.",
    surface:"Textured craft paper with fibrous grain.\nSlightly uneven scissor-cut edges.\nLayers sit a few millimeters apart and cast soft shadows.",
    physics:"Paper puppet physics.\nParts rotate on hinges; nothing bends smoothly.\nWeather and effects are paper shapes sliding across the frame.",
    lock:"Layered paper cut-out look in EVERY frame."},
  felt:{pt:"Feltro e lã stop-motion",en:"Felted wool stop-motion",
    style:"NEEDLE-FELTED WOOL STOP-MOTION.\nCharacters and props made of soft felted wool, fuzzy fibers catching the light.\nMiniature handmade sets of fabric, wood and cardboard.\nAnimated on twos, gentle and tactile.\nNOT smooth CG, NOT photoreal.",
    surface:"Fuzzy wool fibers on every character.\nStitched fabric, raw wood and painted cardboard on the sets.\nSoft, matte materials; nothing shiny.",
    physics:"Soft tabletop physics.\nCharacters move with light, bouncy weight.\nSmoke and clouds are tufts of cotton wool.",
    lock:"Needle-felted wool stop-motion look in EVERY frame."}
};
export const LIGHTS:Record<string,LightPreset>={
  golden:{pt:"Fim de tarde dourado",en:"Golden hour",
    lighting:"Warm golden-hour sun, low in the sky.\nLONG soft shadows across the ground.\nStrong warm rim light on every edge facing the sun.\nCool blue-violet shadows on the shaded sides.\nSoft haze in the distance.",
    grade:"Warm oranges, peach and rust against cool blue-violet shadows.\nRich but soft saturation.",lock:"Golden-hour warm light, blue-violet shadows, glowing rim light."},
  morning:{pt:"Manhã clara",en:"Clear morning",
    lighting:"Cool, clear early-morning light.\nLow sun with pale yellow highlights.\nSoft blue shadows and a thin mist near the ground.\nGentle, even contrast.",
    grade:"Pale yellows and soft pinks against fresh blues and greens.\nLight, airy saturation.",lock:"Cool, clear morning light with pale yellow highlights."},
  overcast:{pt:"Dia nublado suave",en:"Soft overcast",
    lighting:"Soft overcast daylight.\nNo hard shadows; gentle contact shadows only.\nEven, diffused light on faces.\nMuted sky.",
    grade:"Muted, gentle palette with ONE strong accent color.\nLow contrast, soft saturation.",lock:"Soft overcast light, no hard shadows."},
  night:{pt:"Noite com luzes quentes",en:"Night with warm lights",
    lighting:"Night scene lit by practical lights: windows, lamps and signs.\nWarm pools of light against deep blue darkness.\nSoft glow and bloom around every lamp.\nFaces always readable, never lost in black.",
    grade:"Deep blues and teals with warm amber accents.\nRich saturation inside the pools of light.",lock:"Night lighting: warm practical lights against deep blue."},
  storm:{pt:"Tempestade ao entardecer",en:"Stormy dusk",
    lighting:"Stormy dusk under heavy clouds.\nCold blue-grey ambient light with soft rain haze.\nWarm light only from lamps and flames, glowing strongly against the cold.\nFaces always readable.",
    grade:"Cold slate blues and sea greens with small hot amber accents.\nSoft, moody saturation.",lock:"Stormy blue dusk with small warm light sources."},
  interior:{pt:"Interior aconchegante",en:"Cozy interior",
    lighting:"Cozy interior lit by a window and ONE warm lamp.\nSoft window light from one side, warm lamp fill from the other.\nGentle shadows, dust motes in the light beam.",
    grade:"Warm ambers and soft browns with cool window-blue accents.\nSoft, cozy saturation.",lock:"Cozy interior light: soft window light plus one warm lamp."},
  sunsetIn:{pt:"Interior com sol de fim de tarde",en:"Indoors, sunset through windows",
    lighting:"Indoor scene lit by a low golden sunset coming through big windows.\nLONG warm beams and long shadows across the floor.\nWarm rim light on every edge facing the windows.\nCool blue-violet shadows deeper inside the room.\nSoft haze in the light beams.",
    grade:"Warm oranges and peach in the light beams against cool blue-violet shadows.\nRich but soft saturation.",lock:"Indoor golden sunset through the windows, blue-violet shadows."},
  store:{pt:"Loja ou escritório iluminado",en:"Bright store or office",
    lighting:"Bright, even overhead lighting of a store or office.\nSoft shadows straight under objects and characters.\nClean highlights on shiny floors and surfaces.\nOne slightly warmer accent light on the main subject.",
    grade:"Clean, bright palette with crisp whites and saturated product colors.\nFresh, high-key look.",lock:"Bright, even overhead indoor light."}
};
