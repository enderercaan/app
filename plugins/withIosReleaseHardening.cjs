const { withXcodeProject } = require('expo/config-plugins');

module.exports = function withIosReleaseHardening(config) {
  return withXcodeProject(config, (cfg) => {
    const section = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(section)) {
      if (!entry || typeof entry !== 'object' || entry.name !== 'Release' || !entry.buildSettings) continue;
      const s = entry.buildSettings;
      // Keep dSYM for crash symbolication while stripping the shipped product and disabling testability.
      s.ENABLE_TESTABILITY = 'NO';
      s.COPY_PHASE_STRIP = 'YES';
      s.STRIP_INSTALLED_PRODUCT = 'YES';
      s.DEAD_CODE_STRIPPING = 'YES';
      s.DEBUG_INFORMATION_FORMAT = 'dwarf-with-dsym';
    }
    return cfg;
  });
};
