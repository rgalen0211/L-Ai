// A SAMPLE of the shared options list (proposals/options.draft.json, revision 3), for the practice data film only. The real list is served by the maker (GET /api/edit/options).
// Wording, control type and limits only: the server schema stays the validator. Made by hand from the list; not a copy of it.
window.ryagramEditOptionsSample = {
 "groups": [
  {
   "id": "look",
   "label": "Look",
   "help": "Colours and shapes."
  },
  {
   "id": "size",
   "label": "Size and speed",
   "help": "How big the film is and how it moves."
  },
  {
   "id": "words",
   "label": "Words on screen",
   "help": "The question and key a viewer reads first."
  },
  {
   "id": "chart",
   "label": "Chart",
   "help": "What the chart shows and how."
  },
  {
   "id": "story",
   "label": "The film",
   "help": "Name, data and years: chosen when the film is made."
  }
 ],
 "rows": [
  {
   "id": "theme",
   "group": "look",
   "label": "Page",
   "help": "Dark or light page behind the film. Dark is the default.",
   "control": "choice",
   "choices": [
    {
     "value": "dark",
     "label": "Dark"
    },
    {
     "value": "light",
     "label": "Light"
    }
   ],
   "default": "dark",
   "status": "built"
  },
  {
   "id": "page_background",
   "group": "look",
   "label": "Page colour",
   "help": "Leave blank to use the page's own colour.",
   "control": "colour",
   "default": {
    "dark": "#14141a",
    "light": "#fcfcfb"
   },
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "text_muted",
   "group": "look",
   "label": "Quiet text colour",
   "help": "Source lines and small print.",
   "control": "colour",
   "default": {
    "dark": "#86857e",
    "light": "#898781"
   },
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "ramp_low",
   "group": "look",
   "label": "Map colour for low values",
   "help": "The colour of the lowest numbers. Drawn only when the map fill is 'Solid'; the default fill is hatched.",
   "control": "colour",
   "default": {
    "dark": "#232838",
    "light": "#eef1f6"
   },
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "ramp_high",
   "group": "look",
   "label": "Map colour for high values",
   "help": "The colour of the highest numbers. Drawn only when the map fill is 'Solid'; the default fill is hatched.",
   "control": "colour",
   "default": {
    "dark": "#e8eefb",
    "light": "#16233f"
   },
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "ramp_mode",
   "group": "look",
   "label": "Map fill",
   "help": "WORDING TO CONFIRM WITH ENGINE: what 'hatch' looks like to a viewer.",
   "control": "choice",
   "choices": [
    {
     "value": "solid",
     "label": "Solid"
    },
    {
     "value": "hatch",
     "label": "Hatched"
    }
   ],
   "default": "hatch",
   "status": "built"
  },
  {
   "id": "ramp_continuous",
   "group": "look",
   "label": "Smooth colours",
   "help": "Colours blend smoothly instead of in bands.",
   "control": "toggle",
   "default": null,
   "status": "built"
  },
  {
   "id": "dots_radius",
   "group": "look",
   "label": "Dot size",
   "help": "Bigger dots are easier to see on a phone.",
   "control": "slider",
   "min": 0.5,
   "max": 6.0,
   "step": 0.5,
   "default": 3.4,
   "status": "built",
   "hard": {
    "min": 0.5,
    "max": 6.0
   }
  },
  {
   "id": "bars_label_width",
   "group": "look",
   "label": "Space for names",
   "help": "Width of the name column, in pixels. Advanced.",
   "control": "number",
   "min": 60,
   "max": 600,
   "default": 190,
   "status": "built",
   "hard": {
    "min": 60,
    "max": 600
   },
   "advanced": true
  },
  {
   "id": "name",
   "group": "story",
   "label": "Film name",
   "help": "Short name for the project (letters, numbers, dashes).",
   "control": "text",
   "default": null,
   "status": "built",
   "hard": {
    "maxLength": 64
   },
   "owner": "ENGINE field, WEB words"
  },
  {
   "id": "hatch_line_color",
   "group": "look",
   "label": "Hatch line colour",
   "help": "Only used when the map fill is hatched.",
   "control": "colour",
   "default": {
    "dark": "#8fb6ea",
    "light": "#3d5a8a"
   },
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "dots_color",
   "group": "look",
   "label": "Dot colour",
   "help": "Places drawn as dots.",
   "control": "colour",
   "default": {
    "dark": "#ff8a3d",
    "light": "#c2410c"
   },
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "dots_baseline_color",
   "group": "look",
   "label": "Dot colour at the start",
   "help": "Where a dot starts from.",
   "control": "colour",
   "default": "#c2185b",
   "status": "built",
   "hard": {
    "pattern": "#RRGGBB"
   }
  },
  {
   "id": "canvas",
   "group": "size",
   "label": "Size",
   "help": "Widescreen for YouTube; vertical for Shorts.",
   "control": "choice",
   "choices": [
    {
     "value": [
      1920,
      1080
     ],
     "label": "Widescreen (1920 x 1080)"
    },
    {
     "value": [
      1280,
      720
     ],
     "label": "Smaller widescreen (1280 x 720)"
    },
    {
     "value": [
      1080,
      1920
     ],
     "label": "Vertical for Shorts (1080 x 1920)",
     "status": "planned",
     "note": "the schema accepts it but a true vertical layout is not built yet (ENGINE profile note); BUILDER's vertical work; show greyed with 'not ready yet'"
    }
   ],
   "default": [
    1920,
    1080
   ],
   "status": "built",
   "hard": {
    "enum": "the three sizes"
   }
  },
  {
   "id": "fps",
   "group": "size",
   "label": "Frames per second (video smoothness, not speed)",
   "help": "Pictures per second of video: 24, 25 or 30. 30 is smoothest; 24 looks more like cinema. It does not change how fast the years go.",
   "control": "choice",
   "choices": [
    {
     "value": 24,
     "label": "24"
    },
    {
     "value": 25,
     "label": "25"
    },
    {
     "value": 30,
     "label": "30 (recommended)"
    }
   ],
   "default": 30,
   "status": "built",
   "hard": {
    "enum": [
     24,
     25,
     30
    ]
   }
  },
  {
   "id": "hold_seconds",
   "group": "size",
   "label": "Pause at the end",
   "help": "Seconds the last picture stays on screen after the final year.",
   "control": "slider",
   "min": 0,
   "max": 10,
   "step": 0.5,
   "default": 0.0,
   "status": "built",
   "hard": {
    "min": 0,
    "max": 10
   }
  },
  {
   "id": "clarity_question",
   "group": "words",
   "label": "Question under the title",
   "help": "The one question this film answers, up to 120 characters. It stays on screen.",
   "control": "text",
   "default": null,
   "status": "planned",
   "hard": {
    "maxLength": 120
   },
   "owner": "ENGINE (clarity-option-a, unmerged)"
  },
  {
   "id": "clarity_detail",
   "group": "words",
   "label": "A line of detail",
   "help": "Optional, under the question.",
   "control": "text",
   "default": null,
   "status": "planned",
   "owner": "ENGINE"
  },
  {
   "id": "clarity_fade",
   "group": "words",
   "label": "How fast the data fades in",
   "help": "0 turns the fade off.",
   "control": "slider",
   "min": 0,
   "max": 3,
   "step": 0.1,
   "default": 0.6,
   "status": "planned",
   "hard": {
    "min": 0,
    "max": 3
   },
   "owner": "ENGINE"
  },
  {
   "id": "clip_render_settings_axis",
   "group": "chart",
   "label": "Bar scale",
   "help": "Fixed or following the data.",
   "control": "choice",
   "default": "fixed",
   "status": "built",
   "hard": {
    "enum": [
     "fixed",
     "dynamic"
    ]
   },
   "owner": "ENGINE field, WEB words"
  },
  {
   "id": "clip_render_settings_measure",
   "group": "chart",
   "label": "Rate or count",
   "help": "Rate or count.",
   "control": "choice",
   "default": "rate",
   "status": "built",
   "hard": {
    "enum": [
     "rate",
     "count"
    ]
   },
   "owner": "ENGINE field, WEB words"
  },
  {
   "id": "clip_render_settings_top_n",
   "group": "chart",
   "label": "Bars shown",
   "help": "How many bars are on screen.",
   "control": "number",
   "default": null,
   "status": "built",
   "hard": {
    "minimum": 1,
    "maximum": 20
   },
   "owner": "ENGINE field, WEB words"
  }
 ]
};
