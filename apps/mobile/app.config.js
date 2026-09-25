module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    ["expo-build-properties", {
      android: { usesCleartextTraffic: process.env.TT_DEMO_LAN_HTTP === "1" },
    }],
  ],
});
