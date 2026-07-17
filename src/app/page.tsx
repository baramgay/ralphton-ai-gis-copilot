import { CopilotApp } from "@/components/copilot/copilot-app";

export default function Home() {
  return <CopilotApp boundaryVersion="20260701" kakaoMapKey={process.env.NEXT_PUBLIC_KAKAO_MAP_KEY} />;
}
