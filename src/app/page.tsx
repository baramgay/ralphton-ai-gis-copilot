import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-16">
      <Card className="w-full overflow-hidden">
        <CardHeader className="border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="secondary">부산 행정동 분석</Badge>
              <CardTitle className="text-3xl tracking-tight">AI GIS 코파일럿</CardTitle>
              <CardDescription className="max-w-2xl text-base">
                공간 데이터와 지역 지표를 한 화면에서 탐색할 수 있는 분석 환경을 준비하고 있습니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 py-8 text-sm text-slate-600 sm:grid-cols-3">
          <p>행정동 경계 기반 탐색</p>
          <p>설명 가능한 GIS 지표</p>
          <p>안전한 서버 연동</p>
        </CardContent>
      </Card>
    </main>
  );
}
