module.exports = {
  extends: [
    'stylelint-config-standard',
    'stylelint-config-tailwindcss',
    'stylelint-config-prettier',
  ],
  rules: {
    'color-function-notation': 'modern',
    'alpha-value-notation': 'number',
    // Allow Tailwind @apply and other at-rules
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['tailwind', 'apply', 'layer', 'config', 'screen'],
      },
    ],
  },
};
