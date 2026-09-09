// =============================================================================
// lib/boq/__tests__/labour-rates.fixture.ts
//
// The real labour_rates table, captured 2026-09-05. Committed so the ENGINE
// itself can be unit-tested: before this, no test called
// generateDeterministicBoq at all, which is exactly why the Joinery and
// Aluminum & Glass sections could ship for two sprints emitting lines with no
// rule_id and nothing failed.
//
// Data, not judgement — do not hand-edit rates here to make a test pass. If the
// table changes shape, re-export it.
// =============================================================================

import type { LabourRate } from "../schema";

export const LABOUR_RATES_FIXTURE = [
  {
    "id": "b36efcba-8f41-4c77-88ad-1804a910cfcc",
    "work_section": "Demolition",
    "description": "Soft strip — carpets, fixtures, fittings removal (no structural)",
    "unit": "m2",
    "rate_low_aed": 25,
    "rate_mid_aed": 40,
    "rate_high_aed": 60,
    "source": "ServiceMarket Dubai renovation guide; public Dubai contractor advertised rates 2024-25",
    "notes": "Includes bagging and removal to skip; excludes skip hire."
  },
  {
    "id": "370e1656-1065-4880-8ad0-9a19ac28b137",
    "work_section": "Demolition",
    "description": "Internal partition demolition (gypsum or 100mm block)",
    "unit": "m2",
    "rate_low_aed": 80,
    "rate_mid_aed": 120,
    "rate_high_aed": 180,
    "source": "BRKZ marketplace; JLL UAE Cost Guide bands",
    "notes": "Excludes structural walls. Heavy-end if asbestos/dust mitigation required."
  },
  {
    "id": "6ab87300-b3b7-47b2-98f2-47b612c635ed",
    "work_section": "Demolition",
    "description": "Floor tile removal — intact substrate",
    "unit": "m2",
    "rate_low_aed": 35,
    "rate_mid_aed": 55,
    "rate_high_aed": 85,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "High-end if substrate damaged and requires patching."
  },
  {
    "id": "12ba3cb0-8733-49d3-ab8a-aa2172686797",
    "work_section": "Demolition",
    "description": "Wall tile removal — bathroom",
    "unit": "m2",
    "rate_low_aed": 45,
    "rate_mid_aed": 70,
    "rate_high_aed": 110,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "Includes tile and adhesive; excludes plaster make-good."
  },
  {
    "id": "bccceece-15e0-47d2-b757-eb3181dfca5b",
    "work_section": "Demolition",
    "description": "Concrete chase cutting for new electrical or plumbing",
    "unit": "lm",
    "rate_low_aed": 40,
    "rate_mid_aed": 65,
    "rate_high_aed": 100,
    "source": "BRKZ; Dubai contractor benchmarks",
    "notes": "Per linear metre; double if wet area waterproofing affected."
  },
  {
    "id": "06a4ca7c-0725-4b08-9a66-7cf54da32359",
    "work_section": "Blockwork",
    "description": "100mm internal block partition — supply and fix",
    "unit": "m2",
    "rate_low_aed": 95,
    "rate_mid_aed": 130,
    "rate_high_aed": 170,
    "source": "BRKZ; JLL UAE Cost Guide bands",
    "notes": "Excludes plaster. Hollow block standard."
  },
  {
    "id": "de1eabe6-b438-49b2-b461-8e454f6b988a",
    "work_section": "Blockwork",
    "description": "200mm internal block partition — supply and fix",
    "unit": "m2",
    "rate_low_aed": 130,
    "rate_mid_aed": 180,
    "rate_high_aed": 240,
    "source": "BRKZ; JLL UAE Cost Guide bands",
    "notes": "Excludes plaster."
  },
  {
    "id": "4e0b13b8-5228-4b52-921e-e23b28240d12",
    "work_section": "Blockwork",
    "description": "Gypsum partition (single-sided, 75mm frame, fibreglass insulation)",
    "unit": "m2",
    "rate_low_aed": 110,
    "rate_mid_aed": 150,
    "rate_high_aed": 200,
    "source": "AECOM ME Handbook; BRKZ",
    "notes": "Includes one face board; double for both faces."
  },
  {
    "id": "6f393270-88ea-4cee-9b47-71f4b6448c94",
    "work_section": "Plaster",
    "description": "Internal cement plaster, 10-15mm one coat",
    "unit": "m2",
    "rate_low_aed": 30,
    "rate_mid_aed": 45,
    "rate_high_aed": 65,
    "source": "JLL UAE Cost Guide; T&T ICMS UAE",
    "notes": "Standard sand/cement mix."
  },
  {
    "id": "a512818a-2374-4b55-a925-27856c18e2ac",
    "work_section": "Plaster",
    "description": "Internal skim or smoothing coat",
    "unit": "m2",
    "rate_low_aed": 25,
    "rate_mid_aed": 35,
    "rate_high_aed": 50,
    "source": "BRKZ; Dubai contractor benchmarks",
    "notes": "Over existing plaster; preparation only."
  },
  {
    "id": "35f1e2c0-13f2-4d59-8d35-2c7031acd7ad",
    "work_section": "Plaster",
    "description": "Make-good plaster repairs",
    "unit": "per location",
    "rate_low_aed": 80,
    "rate_mid_aed": 150,
    "rate_high_aed": 300,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "Patch repairs after demolition; varies with size of patch."
  },
  {
    "id": "5cb86a04-c589-44b3-a264-c8d6896abaeb",
    "work_section": "Floor Finishes",
    "description": "Floor screed 50mm",
    "unit": "m2",
    "rate_low_aed": 40,
    "rate_mid_aed": 60,
    "rate_high_aed": 85,
    "source": "AECOM ME Handbook; BRKZ",
    "notes": "Levelling screed before tile or wood. Add waterproofing for wet areas."
  },
  {
    "id": "0b1eed44-1bd8-4e9b-be5c-322d86f9af8c",
    "work_section": "Floor Finishes",
    "description": "Porcelain floor tiling — labour only",
    "unit": "m2",
    "rate_low_aed": 45,
    "rate_mid_aed": 70,
    "rate_high_aed": 95,
    "source": "BRKZ; ServiceMarket guide",
    "notes": "Tile material excluded. Large-format tiles at high end."
  },
  {
    "id": "02c98db1-5219-4531-8c60-02c2b781eefe",
    "work_section": "Floor Finishes",
    "description": "Engineered wood flooring — installation labour only",
    "unit": "m2",
    "rate_low_aed": 55,
    "rate_mid_aed": 90,
    "rate_high_aed": 140,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "Click-lock at low end; glue-down at high end. Excludes underlay."
  },
  {
    "id": "6905fc03-14f8-4ed6-9776-5d0cc26ab78a",
    "work_section": "Floor Finishes",
    "description": "Skirting installation (MDF or wood)",
    "unit": "lm",
    "rate_low_aed": 30,
    "rate_mid_aed": 55,
    "rate_high_aed": 90,
    "source": "BRKZ; Dubai joinery contractor benchmarks",
    "notes": "Painted MDF at low end; solid wood with stain at high end."
  },
  {
    "id": "76fc3926-a775-49ce-8ceb-7c10c5cfde66",
    "work_section": "Wall Finishes",
    "description": "Ceramic or porcelain wall tiling — bathroom, labour only",
    "unit": "m2",
    "rate_low_aed": 55,
    "rate_mid_aed": 85,
    "rate_high_aed": 120,
    "source": "BRKZ; ServiceMarket guide",
    "notes": "Material excluded. Small mosaic at high end."
  },
  {
    "id": "7a6bbb7d-1549-4bf4-b9c5-e40bf8a21d4f",
    "work_section": "Wall Finishes",
    "description": "Decorative wall panelling — labour only",
    "unit": "m2",
    "rate_low_aed": 120,
    "rate_mid_aed": 200,
    "rate_high_aed": 350,
    "source": "Public Dubai joinery contractor benchmarks",
    "notes": "Wood/MDF panel system; excludes panel material."
  },
  {
    "id": "2c610586-e8e5-4e3b-90c6-0c37fed95d10",
    "work_section": "Wall Finishes",
    "description": "Mirror or feature glass install",
    "unit": "m2",
    "rate_low_aed": 180,
    "rate_mid_aed": 350,
    "rate_high_aed": 700,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "Includes brackets; excludes mirror material. High end for back-painted glass."
  },
  {
    "id": "0e3aa10f-fdd8-4e3c-b7a4-c6217e7d8953",
    "work_section": "Decoration & Painting",
    "description": "Internal painting — 2 coats over prepared surface",
    "unit": "m2",
    "rate_low_aed": 18,
    "rate_mid_aed": 30,
    "rate_high_aed": 45,
    "source": "JLL UAE Cost Guide; ServiceMarket guide",
    "notes": "Standard emulsion. Premium paint adds 30-50%."
  },
  {
    "id": "9b4ce2f5-a23d-427b-82e3-88b0e1899484",
    "work_section": "Decoration & Painting",
    "description": "Wallpaper installation — labour only",
    "unit": "m2",
    "rate_low_aed": 35,
    "rate_mid_aed": 65,
    "rate_high_aed": 110,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "Excludes wallpaper material."
  },
  {
    "id": "90544a22-7bde-4890-aa01-92c2d89da34d",
    "work_section": "Decoration & Painting",
    "description": "Specialist finish — Venetian plaster, limewash, microcement",
    "unit": "m2",
    "rate_low_aed": 90,
    "rate_mid_aed": 180,
    "rate_high_aed": 320,
    "source": "Public Dubai contractor advertised rates 2024-25",
    "notes": "Labour only; specialist applicator required at high end."
  },
  {
    "id": "2fb67979-d614-4a1e-aced-4d447a933208",
    "work_section": "Joinery & Carpentry",
    "description": "Built-in wardrobe — mid-range MDF with lacquer or melamine",
    "unit": "lm",
    "rate_low_aed": 1200,
    "rate_mid_aed": 1800,
    "rate_high_aed": 2800,
    "source": "BRKZ; ServiceMarket guide; Dubai joinery contractor benchmarks",
    "notes": "Per linear metre of wardrobe wall, full height. Hinged doors. Includes basic interior fit-out."
  },
  {
    "id": "0831d932-d971-4cd3-8f52-d6a4896d9e99",
    "work_section": "Joinery & Carpentry",
    "description": "Vanity cabinet with quartz top — bathroom",
    "unit": "per unit",
    "rate_low_aed": 4500,
    "rate_mid_aed": 7000,
    "rate_high_aed": 12000,
    "source": "BRKZ; ServiceMarket guide",
    "notes": "Single basin standard. Double basin or imported stone at high end."
  },
  {
    "id": "d4a9b3de-b9e1-4acb-90cd-8ffda70594d5",
    "work_section": "Joinery & Carpentry",
    "description": "Flush internal door — supply and fit",
    "unit": "per door",
    "rate_low_aed": 1400,
    "rate_mid_aed": 2400,
    "rate_high_aed": 4000,
    "source": "BRKZ; Hafele UAE published rates",
    "notes": "Standard 2.1m height with frame, ironmongery."
  },
  {
    "id": "ffcd66a6-afb9-4f0e-868a-ca4cf2bc4b2e",
    "work_section": "Joinery & Carpentry",
    "description": "Solid wood door — supply and fit",
    "unit": "per door",
    "rate_low_aed": 3500,
    "rate_mid_aed": 6000,
    "rate_high_aed": 12000,
    "source": "Public Dubai joinery contractor benchmarks",
    "notes": "Oak, walnut, or teak. Mid-range is engineered solid; high end is full timber."
  },
  {
    "id": "052098eb-1a9c-4970-ae5d-4a30df467fd5",
    "work_section": "Joinery & Carpentry",
    "description": "Wardrobe sliding doors (mirror or matte panels)",
    "unit": "lm",
    "rate_low_aed": 1500,
    "rate_mid_aed": 2800,
    "rate_high_aed": 5500,
    "source": "Public Dubai joinery contractor benchmarks",
    "notes": "Per linear metre. Mirror at low end; lacquer or veneer at high end."
  },
  {
    "id": "3d9e8326-b171-4862-a6ef-702de6c3ed57",
    "work_section": "Joinery & Carpentry",
    "description": "TV unit / media wall (built-in)",
    "unit": "per unit",
    "rate_low_aed": 8000,
    "rate_mid_aed": 15000,
    "rate_high_aed": 28000,
    "source": "Public Dubai joinery contractor benchmarks",
    "notes": "Linear ~3m typical. Mid-range MDF; high end with stone or wood feature."
  },
  {
    "id": "5a6befa2-3058-4713-8148-ffa95bc63794",
    "work_section": "Sanitaryware",
    "description": "WC suite supply and install — mid-range",
    "unit": "per item",
    "rate_low_aed": 1400,
    "rate_mid_aed": 2400,
    "rate_high_aed": 5500,
    "source": "Danube Home / Geberit / Roca UAE published prices + install",
    "notes": "Wall-hung adds AED 800-1500. Excludes concealed cistern and frame."
  },
  {
    "id": "8d508f5a-617f-4182-989f-e7316421486c",
    "work_section": "Sanitaryware",
    "description": "Wash basin with mixer — supply and install",
    "unit": "per item",
    "rate_low_aed": 900,
    "rate_mid_aed": 1800,
    "rate_high_aed": 4500,
    "source": "Danube Home / Roca / Hansgrohe UAE published prices + install",
    "notes": "Counter-top basin at low end; vessel basin and premium mixer at high end."
  },
  {
    "id": "68fd5f78-02a8-430a-8d40-1a213c0038a9",
    "work_section": "Sanitaryware",
    "description": "Shower system — mixer, handset, rain head",
    "unit": "per set",
    "rate_low_aed": 1500,
    "rate_mid_aed": 3500,
    "rate_high_aed": 9000,
    "source": "Hansgrohe / Grohe / Roca UAE published prices + install",
    "notes": "Concealed valve at high end requires wall preparation."
  },
  {
    "id": "d34cb853-2537-4840-a181-28c64978f99b",
    "work_section": "Sanitaryware",
    "description": "Bathtub — supply and install",
    "unit": "per item",
    "rate_low_aed": 2500,
    "rate_mid_aed": 5500,
    "rate_high_aed": 15000,
    "source": "Danube Home; Hafele UAE",
    "notes": "Acrylic standard; freestanding stone or copper at high end."
  },
  {
    "id": "39993695-6570-4011-b98e-abbf88a14e4d",
    "work_section": "Electrical",
    "description": "Full rewire — residential",
    "unit": "m2",
    "rate_low_aed": 180,
    "rate_mid_aed": 280,
    "rate_high_aed": 400,
    "source": "BRKZ; T&T ICMS UAE; Dubai contractor benchmarks",
    "notes": "Includes consumer unit upgrade for high end. DEWA inspection fee separate."
  },
  {
    "id": "c8630183-7f51-418b-bf3f-423298ee2062",
    "work_section": "Electrical",
    "description": "Light point — supply and install",
    "unit": "per point",
    "rate_low_aed": 95,
    "rate_mid_aed": 150,
    "rate_high_aed": 260,
    "source": "BRKZ; Dubai contractor benchmarks",
    "notes": "Point only; fitting separate."
  },
  {
    "id": "6b992cd4-c9f2-411b-aec9-d5012ff49038",
    "work_section": "Electrical",
    "description": "Power socket or switch — supply and install",
    "unit": "per point",
    "rate_low_aed": 90,
    "rate_mid_aed": 140,
    "rate_high_aed": 220,
    "source": "BRKZ; Schneider / Legrand UAE published rates + install",
    "notes": "Single-gang standard; smart at high end."
  },
  {
    "id": "763d7635-58f5-4adc-ad88-d398d9d02b2e",
    "work_section": "Electrical",
    "description": "LED downlight — supply and install",
    "unit": "per fitting",
    "rate_low_aed": 110,
    "rate_mid_aed": 180,
    "rate_high_aed": 300,
    "source": "BRKZ; Lighting Cluster UAE published rates",
    "notes": "Standard 7W at low end; dim-to-warm or trimless at high end."
  },
  {
    "id": "8b02b622-ef67-4812-8362-804afecef425",
    "work_section": "Plumbing",
    "description": "Bathroom plumbing rewire — per bathroom, full",
    "unit": "per bathroom",
    "rate_low_aed": 4500,
    "rate_mid_aed": 7500,
    "rate_high_aed": 13000,
    "source": "BRKZ; ServiceMarket guide",
    "notes": "Includes new pipe runs, traps, valves. Excludes sanitaryware."
  },
  {
    "id": "acfef527-0763-4f29-a50f-a45bf83fb5ea",
    "work_section": "Plumbing",
    "description": "Concealed water heater — supply and install",
    "unit": "per unit",
    "rate_low_aed": 1500,
    "rate_mid_aed": 2800,
    "rate_high_aed": 5000,
    "source": "Ariston / Bosch UAE published prices + install",
    "notes": "Standard 50L at low end; instant electric at high end."
  },
  {
    "id": "2e141b84-45c8-4608-8f34-dde3b89474b3",
    "work_section": "Plumbing",
    "description": "Floor drain — supply and install",
    "unit": "per item",
    "rate_low_aed": 350,
    "rate_mid_aed": 650,
    "rate_high_aed": 1200,
    "source": "BRKZ; Geberit UAE published rates",
    "notes": "Linear drain at high end."
  },
  {
    "id": "7a5d8d64-fbf3-43fd-b478-3b3ef1b4b8ac",
    "work_section": "MEP / HVAC",
    "description": "Split AC unit (1.5-2.5 ton) — supply and install",
    "unit": "per unit",
    "rate_low_aed": 3500,
    "rate_mid_aed": 5500,
    "rate_high_aed": 8500,
    "source": "O General / SKM / LG UAE published prices + install",
    "notes": "Inverter standard. High end for premium brand or larger capacity."
  },
  {
    "id": "99adce87-1672-47fd-91ec-e14a76617f3c",
    "work_section": "MEP / HVAC",
    "description": "Concealed ducted AC FCU replacement",
    "unit": "per zone",
    "rate_low_aed": 8000,
    "rate_mid_aed": 14000,
    "rate_high_aed": 22000,
    "source": "SKM / Trane UAE published rates",
    "notes": "Replacement only; new ductwork separate."
  },
  {
    "id": "1cdca3a8-b57b-4efc-8cd9-2ba843929847",
    "work_section": "MEP / HVAC",
    "description": "AC servicing and cleaning",
    "unit": "per unit",
    "rate_low_aed": 200,
    "rate_mid_aed": 350,
    "rate_high_aed": 600,
    "source": "ServiceMarket pricing",
    "notes": "Per visit. Deep clean at high end."
  },
  {
    "id": "0e4eae64-921c-47af-9c54-1a98edef5188",
    "work_section": "Lighting",
    "description": "Decorative pendant — installation labour only",
    "unit": "per fitting",
    "rate_low_aed": 150,
    "rate_mid_aed": 280,
    "rate_high_aed": 500,
    "source": "Dubai contractor benchmarks",
    "notes": "Standard ceiling rose at low end; statement chandelier at high end."
  },
  {
    "id": "43e6564f-85c5-4977-a982-41809085c7ac",
    "work_section": "Lighting",
    "description": "Track lighting system — installation labour, per 3m run",
    "unit": "per run",
    "rate_low_aed": 280,
    "rate_mid_aed": 450,
    "rate_high_aed": 800,
    "source": "Dubai contractor benchmarks",
    "notes": "Excludes fittings."
  },
  {
    "id": "35a85ee4-3688-4767-9712-e83918b7ac46",
    "work_section": "Preliminaries",
    "description": "Site setup, protection, daily clean — residential first-floor refit",
    "unit": "per project",
    "rate_low_aed": 6000,
    "rate_mid_aed": 12000,
    "rate_high_aed": 25000,
    "source": "AECOM ME Handbook; T&T ICMS UAE",
    "notes": "Scales with project duration. Floor protection, dust sheeting, daily housekeeping."
  },
  {
    "id": "c76a8258-bab4-4aab-8625-3ac08f15e578",
    "work_section": "Preliminaries",
    "description": "Permit and DM/DEWA fees — typical first-floor refit",
    "unit": "per project",
    "rate_low_aed": 2500,
    "rate_mid_aed": 6000,
    "rate_high_aed": 15000,
    "source": "Dubai Municipality / DEWA published fee schedules",
    "notes": "Building modification permit, MEP approvals, completion certificate. Excludes structural changes."
  },
  {
    "id": "704605ef-474d-457f-aa4f-8191e3f2e476",
    "work_section": "Preliminaries",
    "description": "Skip hire and waste disposal",
    "unit": "per skip",
    "rate_low_aed": 800,
    "rate_mid_aed": 1500,
    "rate_high_aed": 3000,
    "source": "Public Dubai waste contractor advertised rates 2024-25",
    "notes": "6 yard standard. Mixed waste at high end."
  },
  {
    "id": "0d8255bd-d0b2-403f-a05c-74c73f335963",
    "work_section": "Labour Day Rates",
    "description": "Carpenter — skilled",
    "unit": "per day",
    "rate_low_aed": 250,
    "rate_mid_aed": 350,
    "rate_high_aed": 500,
    "source": "BRKZ; UAE federal labour rate guides 2024",
    "notes": "Per 8-hour day. Premium specialist (e.g. veneer) at high end."
  },
  {
    "id": "2f6e4c18-3259-4812-8b65-3b1de71e4ea5",
    "work_section": "Labour Day Rates",
    "description": "Mason — skilled",
    "unit": "per day",
    "rate_low_aed": 220,
    "rate_mid_aed": 300,
    "rate_high_aed": 450,
    "source": "BRKZ; UAE federal labour rate guides 2024",
    "notes": "Per 8-hour day."
  },
  {
    "id": "8103a947-45e7-47ff-9bbb-50d5c6289ac9",
    "work_section": "Labour Day Rates",
    "description": "Plumber — skilled",
    "unit": "per day",
    "rate_low_aed": 280,
    "rate_mid_aed": 400,
    "rate_high_aed": 550,
    "source": "BRKZ; UAE federal labour rate guides 2024",
    "notes": "Per 8-hour day. Certified for water heater connection at high end."
  },
  {
    "id": "894fdae6-fc76-4848-80d3-482a8ebecd2c",
    "work_section": "Labour Day Rates",
    "description": "Electrician — skilled",
    "unit": "per day",
    "rate_low_aed": 280,
    "rate_mid_aed": 400,
    "rate_high_aed": 550,
    "source": "BRKZ; UAE federal labour rate guides 2024",
    "notes": "Per 8-hour day. DEWA-approved required for tested work."
  },
  {
    "id": "be4bf69e-730a-4a83-89ae-8dc8a4a0f517",
    "work_section": "Labour Day Rates",
    "description": "Painter — skilled",
    "unit": "per day",
    "rate_low_aed": 200,
    "rate_mid_aed": 280,
    "rate_high_aed": 400,
    "source": "BRKZ; UAE federal labour rate guides 2024",
    "notes": "Per 8-hour day. Specialist finish at high end."
  },
  {
    "id": "36566a4f-936d-4b5f-9647-8325a2a7f748",
    "work_section": "Labour Day Rates",
    "description": "Helper / labourer",
    "unit": "per day",
    "rate_low_aed": 100,
    "rate_mid_aed": 180,
    "rate_high_aed": 280,
    "source": "BRKZ; UAE federal labour rate guides 2024",
    "notes": "Per 8-hour day."
  }
] as unknown as LabourRate[];
