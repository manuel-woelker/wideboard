import type { StorybookConfig } from '@storybook/react-vite';

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
  }
};

export default config;
