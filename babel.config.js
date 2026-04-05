module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '@': './src',
            '@core': './src/core',
            '@features': './src/features',
            '@shared': './src/shared',
          },
          extensions: ['.tsx', '.ts', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
