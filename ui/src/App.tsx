import styled from '@emotion/styled';

const Shell = styled.main`
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at top, #f5f3ea 0%, #e7e0cf 42%, #d1c5aa 100%);
  color: #251f13;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
`;

const Card = styled.section`
  width: min(560px, calc(100vw - 2rem));
  border-radius: 1rem;
  padding: 2rem;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 18px 45px rgba(37, 31, 19, 0.15);
`;

const Heading = styled.h1`
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
`;

const Lead = styled.p`
  margin: 0.9rem 0 0;
  line-height: 1.55;
`;

const Badge = styled.span`
  display: inline-block;
  margin-top: 1.2rem;
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  background: #2f4f4f;
  color: #f8f5eb;
  font-size: 0.85rem;
  font-weight: 600;
`;

export function App() {
  return (
    <Shell>
      <Card>
        <Heading>wideboard UI</Heading>
        <Lead>Basic React, Vite, TypeScript, Vitest, and Emotion setup is ready.</Lead>
        <Badge data-testid="stack-badge">Vite + React + TS + Vitest + Emotion</Badge>
      </Card>
    </Shell>
  );
}
