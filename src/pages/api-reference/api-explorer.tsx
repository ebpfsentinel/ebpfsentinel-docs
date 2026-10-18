import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

// Redoc reads the page's colour mode through a React context Docusaurus only
// provides in the browser, so rendering it during the static build throws
// `Hook useColorMode is called outside the <ColorModeProvider>` and takes the
// whole build with it. The explorer is a client-side widget over a spec served
// as a static file: rendering it browser-side only is what it actually is,
// rather than a workaround.
export default function ApiExplorer(): React.ReactElement {
  const specUrl = useBaseUrl('/openapi.json');

  return (
    <Layout
      title="API Explorer"
      description="The open-source agent HTTP API, rendered from its OpenAPI document."
    >
      <BrowserOnly fallback={<div style={{padding: '2rem'}}>Loading the API reference...</div>}>
        {() => {
          const {RedocStandalone} = require('redoc');
          return (
            <RedocStandalone
              specUrl={specUrl}
              options={{
                theme: {colors: {primary: {main: '#7c5cff'}}},
                hideDownloadButton: false,
                nativeScrollbars: true,
              }}
            />
          );
        }}
      </BrowserOnly>
    </Layout>
  );
}
