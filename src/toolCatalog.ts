// Suggestions for the Tools page: tap what you own instead of typing.
// Each entry: [key, English, German, kind]. Keys must never change (they're saved).
export type CatalogEntry = { key: string; en: string; de: string; kind: "tool" | "supply" };
export type CatalogGroup = {
  id: string;
  icon: string;
  en: string;
  de: string;
  /** If an area or item name contains one of these words, show this group earlier. */
  boost: string[];
  entries: CatalogEntry[];
};

type Row = [string, string, string, ("tool" | "supply")?];
const group = (id: string, icon: string, en: string, de: string, boost: string[], rows: Row[]): CatalogGroup => ({
  id,
  icon,
  en,
  de,
  boost,
  entries: rows.map(([key, e, d, kind]) => ({ key, en: e, de: d, kind: kind ?? "tool" })),
});

export const CATALOG: CatalogGroup[] = [
  group("basics", "🧰", "Basics", "Grundausstattung", [], [
    ["screwdrivers", "Screwdriver set (slotted, Phillips, Pozidriv)", "Schraubendreher-Set (Schlitz, Kreuz, PZ)"],
    ["bits", "Bit set with holder", "Bit-Set mit Halter"],
    ["allen", "Allen key set", "Inbus-Set"],
    ["torx", "Torx key set", "Torx-Set"],
    ["pliers", "Combination pliers", "Kombizange"],
    ["needle-pliers", "Needle-nose pliers", "Spitzzange"],
    ["adj-wrench", "Adjustable wrench", "Rollgabelschlüssel"],
    ["spanners", "Spanner set", "Maulschlüssel-Satz"],
    ["sockets", "Socket set with ratchet", "Steckschlüsselsatz mit Ratsche"],
    ["side-cutters", "Side cutters", "Seitenschneider"],
    ["pipe-wrench", "Pipe wrench", "Rohrzange"],
    ["scissors", "Scissors", "Schere"],
    ["files", "File set", "Feilen-Set"],
    ["chisels", "Wood chisels", "Stechbeitel"],
    ["pry-bar", "Pry bar", "Kuhfuß / Brecheisen"],
    ["caliper", "Caliper", "Messschieber"],
    ["tweezers", "Tweezers", "Pinzette"],
    ["magnet-pickup", "Magnetic pick-up tool", "Magnetheber"],
    ["mirror", "Inspection mirror", "Inspektionsspiegel"],
    ["hammer", "Hammer", "Hammer"],
    ["utility-knife", "Utility knife", "Cuttermesser"],
    ["tape-measure", "Tape measure", "Maßband"],
    ["level", "Spirit level", "Wasserwaage"],
    ["headlamp", "Headlamp / torch", "Stirnlampe / Taschenlampe"],
    ["ladder", "Step ladder", "Trittleiter"],
    ["gloves", "Work gloves", "Arbeitshandschuhe"],
    ["glasses", "Safety glasses", "Schutzbrille"],
    ["mask", "Dust mask (FFP2)", "Staubmaske (FFP2)", "supply"],
    ["ear-protection", "Ear protection", "Gehörschutz"],
  ]),
  group("power", "🔌", "Power tools", "Elektrowerkzeug", ["wall", "wand", "regal", "shelf"], [
    ["drill", "Cordless drill/driver", "Akkuschrauber"],
    ["hammer-drill", "Hammer drill", "Schlagbohrmaschine"],
    ["drill-bits", "Drill bit set (wood, metal, masonry)", "Bohrer-Set (Holz, Metall, Stein)"],
    ["detector", "Stud & cable detector", "Leitungssucher"],
    ["multitool", "Oscillating multi-tool", "Multitool (oszillierend)"],
    ["jigsaw", "Jigsaw", "Stichsäge"],
    ["sander", "Sander", "Schleifmaschine"],
    ["hot-glue", "Hot glue gun", "Heißklebepistole"],
    ["heat-gun", "Heat gun", "Heißluftföhn"],
    ["soldering", "Soldering iron", "Lötkolben"],
    ["staple-gun", "Staple gun", "Tacker"],
    ["angle-grinder", "Angle grinder", "Winkelschleifer"],
    ["extension", "Extension cable", "Verlängerungskabel"],
  ]),
  group("plumbing", "🚿", "Water & drains", "Wasser & Abfluss", ["bad", "bath", "küche", "kitchen", "dusch", "shower", "wasch", "sink", "tap", "hahn"], [
    ["plunger", "Plunger", "Saugglocke / Pümpel"],
    ["drain-snake", "Drain snake", "Rohrreinigungsspirale"],
    ["water-pliers", "Water pump pliers", "Wasserpumpenzange"],
    ["bucket", "Bucket", "Eimer"],
    ["caulk-gun", "Caulking gun", "Kartuschenpresse"],
    ["silicone-tool", "Silicone smoothing tool", "Fugenglätter"],
    ["ptfe", "PTFE / Teflon tape", "Teflonband", "supply"],
    ["silicone", "Sanitary silicone", "Sanitär-Silikon", "supply"],
    ["seals", "Washer & O-ring assortment", "Dichtungs- und O-Ring-Sortiment", "supply"],
    ["descaler", "Descaler", "Entkalker", "supply"],
    ["siphon-wrench", "Siphon / basin wrench", "Siphonschlüssel"],
    ["hemp", "Plumbing hemp & paste", "Hanf & Dichtpaste", "supply"],
    ["drain-cleaner", "Enzyme drain cleaner", "Abflussreiniger (enzymatisch)", "supply"],
    ["aerator", "Spare tap aerator", "Ersatz-Perlator", "supply"],
  ]),
  group("electric", "💡", "Small electrics", "Kleine Elektrik", ["lamp", "lampe", "licht", "light"], [
    ["voltage-tester", "Two-pole voltage tester", "Zweipoliger Spannungsprüfer"],
    ["multimeter", "Multimeter", "Multimeter"],
    ["insulated-screwdrivers", "Insulated screwdrivers (VDE)", "VDE-Schraubendreher"],
    ["wire-stripper", "Wire stripper", "Abisolierzange"],
    ["bulbs", "Spare bulbs (E27 / E14 / GU10)", "Ersatzlampen (E27 / E14 / GU10)", "supply"],
    ["batteries", "Batteries (AA, AAA, CR2032)", "Batterien (AA, AAA, CR2032)", "supply"],
    ["fuses", "Appliance fuses", "Feinsicherungen", "supply"],
    ["cable-ties", "Cable ties", "Kabelbinder", "supply"],
    ["insulating-tape", "Insulating tape", "Isolierband", "supply"],
    ["wago", "Lever connectors (WAGO)", "Verbindungsklemmen (WAGO)", "supply"],
    ["socket-tester", "Socket tester", "Steckdosentester"],
  ]),
  group("bike", "🚲", "Bike", "Fahrrad", ["bike", "fahrrad", "cycle"], [
    ["pump", "Floor pump with gauge", "Standpumpe mit Manometer"],
    ["tyre-levers", "Tyre levers", "Reifenheber"],
    ["patch-kit", "Puncture repair kit", "Flickzeug", "supply"],
    ["spare-tube", "Spare inner tube", "Ersatzschlauch", "supply"],
    ["chain-lube", "Chain lube", "Kettenöl", "supply"],
    ["chain-checker", "Chain wear checker", "Kettenverschleißlehre"],
    ["chain-tool", "Chain tool", "Kettennieter"],
    ["link-pliers", "Quick-link pliers", "Kettenschlosszange"],
    ["pedal-wrench", "Pedal wrench (15 mm)", "Pedalschlüssel (15 mm)"],
    ["spoke-key", "Spoke key", "Speichenschlüssel"],
    ["torque-wrench", "Torque wrench", "Drehmomentschlüssel"],
    ["bike-stand", "Bike repair stand", "Montageständer"],
    ["brake-pads", "Spare brake pads", "Ersatz-Bremsbeläge", "supply"],
    ["cassette-tool", "Cassette lockring tool", "Kassettenabzieher"],
    ["chain-whip", "Chain whip", "Kettenpeitsche"],
    ["bb-tool", "Bottom bracket tool", "Innenlagerwerkzeug"],
    ["cable-cutter", "Bike cable cutter", "Bowdenzugschneider"],
    ["brake-cables", "Spare brake & gear cables", "Ersatz-Brems- und Schaltzüge", "supply"],
    ["grease", "Bike grease", "Fahrradfett", "supply"],
    ["degreaser", "Degreaser", "Entfetter", "supply"],
  ]),
  group("walls", "🎨", "Walls & painting", "Wände & Streichen", ["wohn", "living", "schlaf", "bedroom", "flur", "hall"], [
    ["filler-knife", "Filling knife", "Spachtel"],
    ["filler", "Wall filler", "Spachtelmasse", "supply"],
    ["sandpaper", "Sandpaper (80/120/240)", "Schleifpapier (80/120/240)", "supply"],
    ["painters-tape", "Painter's tape", "Malerkrepp", "supply"],
    ["roller", "Paint roller & tray", "Farbrolle & Wanne"],
    ["brushes", "Paint brushes", "Pinsel"],
    ["dust-sheet", "Dust sheet", "Abdeckfolie", "supply"],
    ["wall-plugs", "Wall plug assortment", "Dübel-Sortiment", "supply"],
    ["screws", "Screw assortment", "Schrauben-Sortiment", "supply"],
    ["acrylic", "Acrylic caulk", "Acryl", "supply"],
  ]),
  group("wood", "🪚", "Wood & furniture", "Holz & Möbel", ["möbel", "furniture", "tisch", "table", "schrank", "wardrobe", "stuhl", "chair", "bett", "bed"], [
    ["handsaw", "Hand saw", "Handsäge"],
    ["clamps", "Clamps", "Schraubzwingen"],
    ["mallet", "Rubber mallet", "Gummihammer"],
    ["square", "Try square", "Anschlagwinkel"],
    ["wood-glue", "Wood glue", "Holzleim", "supply"],
    ["felt-pads", "Felt pads", "Filzgleiter", "supply"],
    ["wood-oil", "Furniture / worktop oil", "Möbel- bzw. Arbeitsplattenöl", "supply"],
    ["fine-steel-wool", "Fine steel wool", "Feine Stahlwolle", "supply"],
    ["furniture-wax", "Furniture wax / repair pens", "Möbelwachs / Reparaturstifte", "supply"],
  ]),
  group("appliances", "🫧", "Appliances & cleaning", "Geräte & Reinigung", ["küche", "kitchen", "wasch", "laundry", "spül", "dish", "hauswirtschaft", "utility"], [
    ["shop-vac", "Wet & dry vacuum", "Nass- und Trockensauger"],
    ["brush-set", "Cleaning brush set", "Reinigungsbürsten-Set"],
    ["wd40", "WD-40 / penetrating oil", "WD-40 / Kriechöl", "supply"],
    ["silicone-spray", "Silicone spray", "Silikonspray", "supply"],
    ["isopropyl", "Isopropyl alcohol", "Isopropanol", "supply"],
    ["vinegar", "Vinegar essence / citric acid", "Essigessenz / Zitronensäure", "supply"],
    ["microfibre", "Microfibre cloths", "Mikrofasertücher", "supply"],
    ["hob-scraper", "Ceramic hob scraper", "Glaskeramik-Schaber"],
    ["oven-cleaner", "Oven cleaner", "Backofenreiniger", "supply"],
    ["dishwasher-salt", "Dishwasher salt", "Spülmaschinensalz", "supply"],
    ["dishwasher-cleaner", "Dishwasher cleaner", "Maschinenreiniger (Spülmaschine)", "supply"],
    ["washer-cleaner", "Washing machine cleaner", "Waschmaschinenreiniger", "supply"],
    ["silicone-grease", "Silicone grease", "Silikonfett", "supply"],
    ["fridge-seal-cleaner", "Gentle cleaner for door seals", "Mildes Reinigungsmittel für Dichtungen", "supply"],
  ]),
  group("glue", "🩹", "Glue & tape", "Kleber & Klebeband", [], [
    ["duct-tape", "Duct tape", "Gewebeband", "supply"],
    ["superglue", "Superglue", "Sekundenkleber", "supply"],
    ["epoxy", "2-part epoxy", "2-Komponenten-Kleber", "supply"],
    ["mounting-adhesive", "Mounting adhesive", "Montagekleber", "supply"],
    ["double-tape", "Double-sided tape", "Doppelseitiges Klebeband", "supply"],
  ]),
  group("garden", "🌱", "Balcony & garden", "Balkon & Garten", ["garden", "garten", "balkon", "balcony"], [
    ["secateurs", "Secateurs", "Gartenschere"],
    ["hose-fittings", "Hose connectors", "Schlauchkupplungen", "supply"],
    ["trowel", "Hand trowel", "Handschaufel"],
    ["wire-brush", "Wire brush", "Drahtbürste"],
  ]),
];

/** Order groups: basics first, then groups that match your areas/items, then the rest. */
export function orderedGroups(homeWords: string[]): CatalogGroup[] {
  const text = homeWords.join(" ").toLowerCase();
  const score = (g: CatalogGroup) => (g.id === "basics" ? 2 : g.boost.some((w) => text.includes(w)) ? 1 : 0);
  return CATALOG.map((g, i) => ({ g, i })).sort((a, b) => score(b.g) - score(a.g) || a.i - b.i).map(({ g }) => g);
}
