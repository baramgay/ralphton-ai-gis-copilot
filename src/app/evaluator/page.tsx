import type { Metadata } from "next";
import Link from "next/link";

import {
  EVALUATOR_CRITERIA,
  EVALUATOR_SCRIPT,
  METHOD_SUMMARY,
} from "@/lib/analysis/evaluator-guide";

import { PrintButton } from "./print-button";

export const metadata: Metadata = {
  title: "평가 인쇄 1페이지",
  description: "부산·경남 AI GIS 코파일럿 평가자용 한 장 요약 (인쇄 최적화)",
  robots: { index: false, follow: false },
};

export default function EvaluatorPrintPage() {
  return (
    <main className="evaluator-print mx-auto max-w-3xl bg-white px-6 py-8 text-slate-900 print:max-w-none print:px-0 print:py-0">
      <header className="border-b border-slate-200 pb-4 print:border-slate-400">
        <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
          부산·경남 AI GIS 코파일럿 · 평가용 1페이지
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">평가자 한 장 요약</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          범위: 부산광역시 + 경상남도 행정동(약 511개) · 시설: HIRA 병원정보서비스 v2 ·
          인구: 주민등록 기반 시연·live 병합 · 지도: Kakao Maps
        </p>
        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800"
          >
            앱으로 돌아가기
          </Link>
          <Link
            href="/api/health"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800"
            target="_blank"
          >
            /api/health
          </Link>
        </div>
      </header>

      <section className="mt-5">
        <h2 className="text-sm font-bold text-slate-900">3분 시연 스크립트</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-snug text-slate-800">
          {EVALUATOR_SCRIPT.map((step) => (
            <li key={step}>{step.replace(/^\d+\.\s*/, "")}</li>
          ))}
        </ol>
      </section>

      <section className="mt-5">
        <h2 className="text-sm font-bold text-slate-900">평가 체크리스트</h2>
        <table className="mt-2 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="px-2 py-1.5 font-bold">항목</th>
              <th className="px-2 py-1.5 font-bold">비중</th>
              <th className="px-2 py-1.5 font-bold">확인 포인트</th>
              <th className="px-2 py-1.5 font-bold">검증 방법</th>
            </tr>
          </thead>
          <tbody>
            {EVALUATOR_CRITERIA.map((item) => (
              <tr key={item.id} className="border-b border-slate-200 align-top">
                <td className="px-2 py-1.5 font-semibold">{item.title}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">
                  {item.weight}
                </td>
                <td className="px-2 py-1.5 text-slate-700">{item.lookFor}</td>
                <td className="px-2 py-1.5 text-slate-700">{item.howToVerify}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 print:border-slate-400">
        <h2 className="text-sm font-bold text-slate-900">방법론 요약</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{METHOD_SUMMARY}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
          <li>시연 합성 데이터와 HIRA·인구 실데이터 구분이 헤더·출처 카드에 표시됩니다.</li>
          <li>키 없이도 빠른 분석 8종·지도·순위가 동작합니다 (Qwen 파서는 키 필요).</li>
          <li>
            운영: <code className="rounded bg-white px-1">/api/health</code> ·{" "}
            <code className="rounded bg-white px-1">/api/data/sync</code> · cron 동기화.
          </li>
        </ul>
      </section>

      <section className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-bold">핵심 기능</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-700">
            <li>의료 취약 순위 · 구/시 비교 · 동 드릴다운</li>
            <li>자연어 질의 (규칙 + 선택적 Qwen)</li>
            <li>Kakao 지도 색상·마커 연동</li>
            <li>CSV · 공유 링크 · 다크 모드</li>
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-bold">한계 (정직 고지)</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-700">
            <li>거리 = 행정동 대표점 직선거리 (도로·대중교통 아님)</li>
            <li>자연증가 = 출생−사망 (전입·전출 제외)</li>
            <li>병원 = HIRA 요양기관 기준 (약국 등 비포함 가능)</li>
            <li>인구 live 병합은 키·API 한도에 의존</li>
          </ul>
        </div>
      </section>

      <footer className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-500 print:border-slate-400">
        <p>
          프로덕션: https://ralphton-ai-gis-copilot.vercel.app · 본 페이지: /evaluator
        </p>
        <p className="mt-1">인쇄 시 배경·버튼은 숨김 · A4 세로 권장</p>
      </footer>

      <style>{`
        @media print {
          @page { margin: 12mm; size: A4; }
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .evaluator-print { font-size: 11pt; }
          .evaluator-print table { font-size: 9pt; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>
    </main>
  );
}
