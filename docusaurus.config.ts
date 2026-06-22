import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'eBPFsentinel',
  tagline: 'Kernel-native network & security platform for Linux',
  favicon: 'img/ebpfsentinel-mark-violet.svg',

  // Update these to the real deploy target before publishing.
  url: 'https://docs.ebpfsentinel.io',
  baseUrl: '/',

  organizationName: 'ebpfsentinel',
  projectName: 'ebpfsentinel-docs',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    // Treat .md as CommonMark (no MDX) so existing files with <, {, etc. don't break.
    format: 'md',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          versions: {
            '2026.6.1': {label: 'v2026.6.1'},
          },
          // editUrl: 'https://github.com/ebpfsentinel/ebpfsentinel-docs/edit/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
    [
      'redocusaurus',
      {
        specs: [
          {
            id: 'agent-api',
            spec: 'static/openapi.json',
            route: '/api-reference/api-explorer/',
          },
        ],
        theme: {primaryColor: '#7c5cff'},
      },
    ],
  ],

  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig: {
    image: 'img/ebpfsentinel-mark-violet.svg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: '',
      logo: {
        alt: 'eBPFsentinel',
        src: 'img/ebpfsentinel-lockup-light.svg',
        srcDark: 'img/ebpfsentinel-lockup-dark.svg',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs'},
        {type: 'docsVersionDropdown', position: 'right'},
        {
          href: 'https://github.com/ebpfsentinel',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/getting-started/quickstart'},
            {label: 'Features', to: '/features/overview'},
            {label: 'Configuration', to: '/configuration/overview'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {label: 'REST API', to: '/api-reference/rest-api'},
            {label: 'CLI', to: '/cli-reference/'},
            {label: 'FAQ', to: '/faq'},
          ],
        },
      ],
      copyright: `eBPFsentinel — AGPL-3.0 (OSS) · Enterprise edition proprietary.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['rust', 'toml', 'bash', 'yaml', 'json', 'protobuf', 'docker', 'nginx'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
