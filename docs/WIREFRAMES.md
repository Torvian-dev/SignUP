# Dashboard wireframes

Covers deliverable 13. Every screen listed here is implemented under `apps/web/src/app/(app)/`.

## Dashboard (`/dashboard`)
```
┌──────────────┬────────────────────────────────────────────────────────────────────────────┐
│ FormAgent    │ Dashboard                                         [ New automation ]       │
│              │ Last 30 days                                                               │
│ ▸ Dashboard  │ ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐               │
│ ▸ New run    │ │Total   ││Success ││Failed  ││Active  ││AI acc. ││Time    │               │
│ ▸ History    │ │  412   ││  371   ││  23    ││   3    ││ 94.2%  ││saved   │               │
│ ▸ Profiles   │ └────────┘└────────┘└────────┘└────────┘└────────┘│  86%   │               │
│ ▸ API keys   │                                                   └────────┘               │
│ ▸ Policy     │ ┌ Runs per day ───────────────────────────┐┌ Confidence scores ─────────┐ │
│ ▸ Audit log  │ │ ▇▆▇█▅▇▇█▆▇ (stacked: ● succeeded ● failed)│ ▁▁▁▁▂▂▃▅█▇ (0–100 %)       │ │
│              │ └──────────────────────────────────────────┘└────────────────────────────┘ │
│              │ ┌ Learning improvements ──────────────────┐┌ API status ────────────────┐ │
│              │ │ ── accepted %   ── answered from memory % ││ claude    ✓ healthy        │ │
│              │ │   ╱‾‾‾‾╲___╱‾‾‾‾‾‾                       ││ openai    ✓ healthy        │ │
│              │ └──────────────────────────────────────────┘│ 2captcha  ⚠ degraded       │ │
│              │                                             │ capsolver ✓ healthy        │ │
│              │                                             └────────────────────────────┘ │
│              │ ┌ CAPTCHA performance ────────────────────┐┌ Provider usage ────────────┐ │
│              │ │Provider  Type      Att. Succ. Time $/solve││Provider Calls Succ Fail $  │ │
│              │ │2captcha  recap_v2  120  93%  21s .0029  ││claude   1.2k  99%  4  $41  │ │
│              │ └──────────────────────────────────────────┘└────────────────────────────┘ │
│              │ ┌ Recent activity ─────────────────────────────────────────────────────┐ │
│              │ │ supplier.example — Ready for review                      14:02       │ │
│              │ │ portal.example   — Solved via capsolver                  14:01       │ │
└──────────────┴────────────────────────────────────────────────────────────────────────────┘
```

## New automation (`/runs/new`)
```
┌ New automation ────────────────────────────────────────┐
│ Website URL   [ https://supplier-portal.example/reg  ] │
│ Profile       [ Profile A – John Smith            ▾ ] │
│ Intent        [ Detect automatically              ▾ ] │
│                              [  Start agent  ]         │
└────────────────────────────────────────────────────────┘
```

## Run console + review (`/runs/[id]`)
```
┌ supplier.example ───────────┐ ┌ Review before submitting ───────────────────────────────────────┐
│ [awaiting review] conf 91%  │ │ 2 field(s) need your attention. The agent learns from every change.│
│ 14:00 Opening supplier...   │ │ ┌──────────── screenshot (passwords masked) ─────────────────┐  │
│ 14:00 Followed sign-up link │ │ └────────────────────────────────────────────────────────────┘  │
│ 14:01 Mapped 18/19 fields   │ │ Field          Filled with          Conf  Why            Correct │
│ 14:01 Detected turnstile    │ │ Forename *     John                 97%   autocomplete…  [▾]    │
│ 14:01 Solved via capsolver  │ │                personal.firstName   memory                      │
│ 14:02 Ready for review      │ │ ⚠ Trading name  —                   41%   no slot fits   [Type…]│
│                             │ │ ⚠ VAT number *  —  invalid          62%   custom.tax_id  [▾]    │
│ [Cancel]                    │ │ Approving ticks the terms box and clicks "Create account".      │
└─────────────────────────────┘ │                                        [ Approve & submit ]    │
                                └─────────────────────────────────────────────────────────────────┘
 (awaiting_manual → right panel becomes LIVE VIEW: streamed browser, click to interact, [Done])
```

## Profile editor (`/profiles/[id]`)
```
Profile ── name [Profile A – John Smith]  ☑ default
Personal ─ First [John] Last [Smith] Email [john@email.com] Phone [07123456789]
Address ── Line1 [..] Line2 [..] City [..] County/State [..] Postcode [..] Country [GB]
Proxy ──── ☑ Route this profile through a proxy (one per profile)
           Type [HTTP▾] Host [gb.proxy…] Port [8080] User [..] Password [••••] Rotate every [90] days
Custom ─── Label [Date of Birth] Type [date▾] Value [1990-03-07] Synonyms [DOB, Birthday] 🗑
           [+ Username] [+ Business Name] [+ VAT / Tax ID] [+ Passport Number] [+ Custom field]
                                                                     [Cancel] [Save profile]
```

## API keys (`/admin/api-keys`)
```
AI providers                     Failover: Claude → OpenAI → Gemini
 ↑↓ Claude (primary) ••••a1B2 · rotated 01/11   [✓ healthy] [Test connection] [Replace key] ☑ Active
 ↑↓ OpenAI (primary) ••••9xQ0                    [? unknown] [Test connection] [Replace key] ☑ Active
 [+ Claude] [+ OpenAI] [+ Google Gemini]
CAPTCHA providers                Failover: 2Captcha → CapSolver → Anti-Captcha → …
 …  [+ DispurCaptcha] [+ Resolvr] [+ Other (compatible)]   ← asks for API base URL
Browser services · Proxy providers · Email services (same pattern)
```
