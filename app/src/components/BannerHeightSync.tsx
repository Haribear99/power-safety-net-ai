"use client";
// 법정 배너의 실제 높이를 --banner-h로 내보낸다. 배너는 글꼴·폭에 따라 두 줄이 될 수 있어(약 640~690px),
// 고정 높이(29px)에 맞춰 붙여 둔 /ops 상단 바·/lab 탭 바가 가려지던 문제를 막는다. 값이 없을 때(JS 전)는 각 화면의 29px 기본값을 쓴다.
import { useEffect } from "react";

export function BannerHeightSync() {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="legal-banner"]');
    if (!el) return;
    const root = document.documentElement.style;
    // 한 줄 배너(29px 기본값과 같음)면 쓰지 않는다: 하이드레이션 중 루트 스타일을 바꾸면 문서 전체를 다시 계산해 첫 그리기가 늦어진다(운영 LCP 예산)
    const set = () => {
      const h = el.getBoundingClientRect().height;
      if (Math.abs(h - 29) < 0.5 && !root.getPropertyValue("--banner-h")) return;
      root.setProperty("--banner-h", `${h}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return null;
}
