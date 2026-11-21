const APP_VARIANTS = {
  development: {
    key: "development",
    name: "ReadAny Dev",
    bundleIdentifier: "com.readany.app.dev",
    androidPackage: "com.readany.app.dev",
    scheme: "readany-dev",
  },
  preview: {
    key: "preview",
    name: "ReadAny Preview",
    bundleIdentifier: "com.readany.app.preview",
    androidPackage: "com.readany.app.preview",
    scheme: "readany-preview",
  },
  mlx: {
    key: "mlx",
    name: "ReadAny MLX",
    bundleIdentifier: "com.readany.mlx.dev",
    androidPackage: "com.readany.app.dev",
    scheme: "readany-mlx",
  },
  production: {
    key: "production",
    name: "ReadAny",
    bundleIdentifier: "com.readany.app",
    androidPackage: "com.readany.app",
    scheme: "readany",
  },
};

const VARIANT_ALIASES = {
  dev: "development",
  development: "development",
  local: "development",
  debug: "development",
  "development-simulator": "development",
  preview: "preview",
  mlx: "mlx",
  staging: "preview",
  test: "preview",
  prod: "production",
  production: "production",
  release: "production",
};

function normalizeAppVariant(value) {
  const rawVariant = String(value || "")
    .trim()
    .toLowerCase();

  if (VARIANT_ALIASES[rawVariant]) {
    return VARIANT_ALIASES[rawVariant];
  }

  if (rawVariant.includes("production")) {
    return "production";
  }

  if (rawVariant.includes("preview") || rawVariant.includes("staging")) {
    return "preview";
  }

  return "development";
}

function getAppVariant() {
  return normalizeAppVariant(
    process.env.APP_VARIANT || process.env.EAS_BUILD_PROFILE || "development",
  );
}

function getAppVariantConfig() {
  const variant = APP_VARIANTS[getAppVariant()];
  const bundleIdentifier = process.env.READANY_MLX_BUNDLE_ID?.trim();
  if (variant.key !== "mlx" || !bundleIdentifier) return variant;
  const reserved = Object.values(APP_VARIANTS).some(
    (candidate) => candidate.key !== "mlx" && candidate.bundleIdentifier === bundleIdentifier,
  );
  if (reserved || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier)) {
    throw new Error("READANY_MLX_BUNDLE_ID must be a valid, separate iOS bundle ID");
  }
  return { ...variant, bundleIdentifier };
}

module.exports = {
  APP_VARIANTS,
  getAppVariant,
  getAppVariantConfig,
  normalizeAppVariant,
};
