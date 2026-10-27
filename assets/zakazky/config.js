// Veřejná konfigurace (publishable key je určený pro prohlížeč – přístup hlídá RLS a serverové funkce).
const base = {
  supabaseUrl: "https://mkfnxysnamantwyftjbk.supabase.co",
  publishableKey: "sb_publishable_H2yVyVYVJfr9dyWFdmXWJw_fq-TQgiN",
};
export const CONFIG = {
  ...base,
  functionsUrl: `${base.supabaseUrl}/functions/v1`,
  contactEmail: "projekce@fvsol.cz",
  tiles: {
    ortofoto: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
    zakladni: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ZTM_WM/MapServer/tile/{z}/{y}/{x}",
  },
  ...(globalThis.FVSOL_CONFIG || {}),
};
