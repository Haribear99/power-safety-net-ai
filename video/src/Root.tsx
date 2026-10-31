import { Composition } from "remotion";
import { Demo, FPS, TOTAL } from "./Demo";

export const RemotionRoot: React.FC = () => {
  return <Composition id="Demo" component={Demo} durationInFrames={Math.round(TOTAL * FPS)} fps={FPS} width={1920} height={1080} />;
};
