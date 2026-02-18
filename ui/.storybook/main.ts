import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

/* 📖 # Why keep Storybook stories colocated with source components?
Story files live next to components so UI examples evolve with implementation changes.
This reduces drift between documented behavior and actual runtime behavior.
*/
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {}
  },
  async viteFinal(baseConfig) {
    const storybookBasePath = process.env.STORYBOOK_BASE_PATH;
    if (!storybookBasePath) {
      return baseConfig;
    }

    /* 📖 # Why use an environment variable for Storybook base path?
    The default local setup should stay simple, but GitHub Pages needs a
    repository-prefixed base path so Storybook can run from /storybook.
    */
    return mergeConfig(baseConfig, {
      base: storybookBasePath
    });
  }
};

export default config;
