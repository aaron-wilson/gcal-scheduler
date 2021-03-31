module.exports = {
  'env': {
    'browser': true,
    'es2021': true,
  },
  'extends': [
    'google',
    'eslint:recommended',
  ],
  'parserOptions': {
    'ecmaVersion': 12,
    'sourceType': 'module',
  },
  'rules': {'object-curly-newline': ['error', {'multiline': true}]},
};
