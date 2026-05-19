import React from "react";
import {
  AbsoluteFill,
  Loop,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { CountUp, PathDraw, PopIn, StackReveal } from "./motion-primitives";

const W = 1080;
const H = 1920;

const SAFE = {
  top: 214,
  rightRailX: 900,
  subtitleY: 1302,
  titleY: 1512,
  leftPad: 42,
  contentRight: 884,
};

const C = {
  bg: "#071016",
  ink: "#F8FAFC",
  inkSoft: "#CBD5E1",
  inkMuted: "#94A3B8",
  red: "#EF4444",
  blue: "#2563EB",
  cyan: "#22D3EE",
  green: "#22C55E",
  amber: "#F59E0B",
  card: "rgba(247, 250, 252, 0.94)",
  darkCard: "rgba(15, 23, 42, 0.78)",
  line: "rgba(148, 163, 184, 0.36)",
};

const F = {
  sans: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  num: '"Bahnschrift", "DIN Alternate", "Microsoft YaHei", sans-serif',
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const SafeAreaOverlay: React.FC = () => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: W,
        height: SAFE.top,
        background: "rgba(0,0,0,0.5)",
        zIndex: 20,
        color: "rgba(255,255,255,0.52)",
        fontFamily: F.sans,
        fontSize: 18,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        paddingBottom: 12,
      }}
    >
      平台顶部搜索/状态栏安全区
    </div>
    <div
      style={{
        position: "absolute",
        top: SAFE.top,
        right: 0,
        width: W - SAFE.rightRailX,
        height: SAFE.titleY - SAFE.top,
        borderLeft: "2px dashed rgba(255,255,255,0.55)",
        background: "rgba(255,255,255,0.08)",
        zIndex: 20,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 390,
          left: 16,
          width: 114,
          display: "grid",
          gap: 28,
          justifyItems: "center",
          color: "rgba(255,255,255,0.72)",
          fontFamily: F.sans,
          fontSize: 24,
          fontWeight: 800,
        }}
      >
        {["♥", "评", "★", "↗"].map((label) => (
          <div
            key={label}
            style={{
              width: 74,
              height: 74,
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        top: SAFE.subtitleY,
        width: SAFE.rightRailX,
        height: SAFE.titleY - SAFE.subtitleY,
        borderTop: "2px dashed rgba(255,255,255,0.4)",
        borderBottom: "2px dashed rgba(255,255,255,0.4)",
        zIndex: 20,
        pointerEvents: "none",
        color: "rgba(255,255,255,0.42)",
        fontFamily: F.sans,
        fontSize: 18,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: 8,
      }}
    >
      真实字幕安全区
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: H - SAFE.titleY,
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.24), rgba(0,0,0,0.88) 34%, rgba(0,0,0,0.96))",
        borderTop: "2px dashed rgba(255,255,255,0.4)",
        zIndex: 20,
        color: "rgba(255,255,255,0.58)",
        fontFamily: F.sans,
        fontSize: 22,
        padding: "38px 38px",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 30, marginBottom: 14 }}>@医生账号 · 2天前</div>
      <div>标题/评论输入区：只放解释性小字，不放关键判断、红框或图表</div>
    </div>
  </>
);

const DoctorLeft: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({
    frame,
    fps,
    config: { mass: 0.9, damping: 20, stiffness: 95 },
    durationInFrames: 34,
  });
  const bob = Math.sin(frame / 18) * 4;
  return (
    <div
      style={{
        position: "absolute",
        left: 34,
        top: 760 + bob,
        width: 336,
        height: 670,
        zIndex: 9,
        transform: `translateX(${interpolate(t, [0, 1], [-54, 0])}px)`,
        opacity: interpolate(t, [0, 0.35, 1], [0, 1, 1]),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 38,
          top: 0,
          width: 232,
          height: 232,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 50% 42%, #F4C8A3 0 58%, #D8A67F 59% 100%)",
          boxShadow: "0 18px 52px rgba(0,0,0,0.42)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 95,
          top: 64,
          width: 124,
          height: 36,
          border: "6px solid rgba(15,23,42,0.72)",
          borderRadius: 18,
          boxShadow: "90px 0 0 -6px rgba(15,23,42,0.72)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 36,
          top: 214,
          width: 262,
          height: 418,
          borderRadius: "104px 104px 22px 22px",
          background: "linear-gradient(180deg, #0F172A, #020617)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 92,
          top: 250,
          width: 150,
          height: 230,
          background: "#F8FAFC",
          clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
          opacity: 0.92,
        }}
      />
    </div>
  );
};

const TopQuestion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 8, fps, config: { mass: 0.7, damping: 15, stiffness: 130 } });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.leftPad,
        top: SAFE.top + 42,
        width: 838,
        height: 178,
        zIndex: 6,
        transform: `translateY(${interpolate(s, [0, 1], [-28, 0])}px)`,
        opacity: clamp01(s),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          height: "100%",
          borderRadius: 26,
          background: "linear-gradient(135deg, #FFFFFF 0%, #EAF2FF 100%)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.34)",
          border: "1px solid rgba(255,255,255,0.72)",
          padding: "20px 28px",
        }}
      >
        <div
          style={{
            flex: "0 0 118px",
            height: 118,
            borderRadius: 18,
            background: "linear-gradient(180deg, #F97316, #F59E0B)",
            color: "#FFFFFF",
            fontFamily: F.num,
            fontSize: 92,
            fontWeight: 900,
            lineHeight: "118px",
            textAlign: "center",
            textShadow: "0 4px 0 rgba(0,0,0,0.22)",
          }}
        >
          Q
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: "#0F172A",
              fontFamily: F.sans,
              fontSize: 54,
              lineHeight: 1.12,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            低密度胆固醇 3.7
          </div>
          <div
            style={{
              color: "#1D4ED8",
              fontFamily: F.sans,
              fontSize: 45,
              lineHeight: 1.14,
              fontWeight: 900,
              marginTop: 6,
            }}
          >
            要不要吃药？
          </div>
        </div>
      </div>
    </div>
  );
};

const LabReport: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 36, fps, config: { mass: 0.8, damping: 17, stiffness: 110 } });
  const zoom = interpolate(frame, [122, 170], [1, 1.08], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rows = [
    ["甘油三酯", "1.68", "mmol/L"],
    ["总胆固醇", "5.06", "mmol/L"],
    ["高密度脂蛋白", "0.98", "mmol/L"],
    ["低密度脂蛋白", "3.70", "mmol/L"],
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: 404,
        top: 548,
        width: 468,
        zIndex: 5,
        transform: `translateY(${interpolate(enter, [0, 1], [64, 0])}px) scale(${interpolate(
          enter,
          [0, 1],
          [0.92, zoom]
        )})`,
        opacity: clamp01(enter),
        transformOrigin: "center",
      }}
    >
      <div
        style={{
          borderRadius: 18,
          overflow: "hidden",
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.42)",
        }}
      >
        <div
          style={{
            height: 64,
            background: "#E2E8F0",
            color: "#0F172A",
            display: "grid",
            gridTemplateColumns: "1.5fr 0.8fr 0.9fr",
            alignItems: "center",
            padding: "0 20px",
            fontFamily: F.sans,
            fontSize: 25,
            fontWeight: 900,
          }}
        >
          <span>项目名称</span>
          <span>结果</span>
          <span>单位</span>
        </div>
        {rows.map((r, i) => {
          const isKey = i === 3;
          return (
            <div
              key={r[0]}
              style={{
                height: 70,
                display: "grid",
                gridTemplateColumns: "1.5fr 0.8fr 0.9fr",
                alignItems: "center",
                padding: "0 20px",
                fontFamily: F.sans,
                fontSize: isKey ? 29 : 25,
                fontWeight: isKey ? 900 : 650,
                color: "#111827",
                borderTop: "1px solid #E5E7EB",
                background: isKey ? "#FFF7ED" : "#FFFFFF",
              }}
            >
              <span>{r[0]}</span>
              <span style={{ color: isKey ? C.red : "#111827", fontFamily: F.num }}>{r[1]}</span>
              <span>{r[2]}</span>
            </div>
          );
        })}
      </div>
      {frame >= 110 && (
        <svg
          width={468}
          height={352}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <PathDraw
            startFrame={110}
            durationFrames={22}
            d="M 12 278 L 456 278 L 456 344 L 12 344 Z"
            stroke={C.red}
            strokeWidth={8}
            pathLength={1040}
          />
        </svg>
      )}
    </div>
  );
};

const EvidenceBoard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 150, fps, config: { mass: 0.8, damping: 17, stiffness: 110 } });
  const exit = interpolate(frame, [226, 252], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 398,
        top: 902,
        width: 472,
        zIndex: 7,
        opacity: clamp01(enter) * exit,
        transform: `translateY(${interpolate(enter, [0, 1], [38, 0])}px)`,
      }}
    >
      <div
        style={{
          borderRadius: 24,
          background: "rgba(15,23,42,0.82)",
          border: "1px solid rgba(255,255,255,0.16)",
          color: C.ink,
            padding: "22px 24px",
          boxShadow: "0 24px 70px rgba(0,0,0,0.34)",
          fontFamily: F.sans,
        }}
      >
        <div style={{ color: C.inkMuted, fontSize: 23, fontWeight: 800, marginBottom: 10 }}>
          判断不看单个数字
        </div>
        <div style={{ fontSize: 40, lineHeight: 1.08, fontWeight: 950 }}>
          先看有没有
          <span style={{ color: C.amber }}>高危因素</span>
        </div>
        <StackReveal startFrame={172} staggerFrames={12} slideFrom="right" slideDistance={34} style={{ marginTop: 18 }}>
          <Chip label="冠心病 / 支架术后" color={C.red} />
          <Chip label="糖尿病 / 高血压" color={C.amber} />
          <Chip label="吸烟 / 家族史" color={C.cyan} />
        </StackReveal>
      </div>
    </div>
  );
};

const Chip: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <div
    style={{
      height: 52,
      borderRadius: 14,
      marginTop: 10,
      padding: "0 18px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: "rgba(255,255,255,0.1)",
      color: C.ink,
      fontFamily: F.sans,
      fontSize: 23,
      fontWeight: 850,
    }}
  >
    <span style={{ width: 13, height: 13, borderRadius: 99, background: color }} />
    {label}
  </div>
);

const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  const show = frame >= 242;
  return (
    <div
      style={{
        position: "absolute",
        left: 394,
        top: 1046,
        width: 476,
        zIndex: 8,
        opacity: show ? 1 : 0,
      }}
    >
      <PopIn startFrame={242} durationFrames={22}>
        <div
          style={{
            borderRadius: 24,
            background: "linear-gradient(135deg, #DC2626 0%, #7F1D1D 100%)",
            padding: "22px 26px 26px",
            boxShadow: "0 28px 80px rgba(127,29,29,0.48)",
            color: "#FFFFFF",
            fontFamily: F.sans,
            border: "1px solid rgba(255,255,255,0.28)",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 850, opacity: 0.9, marginBottom: 8 }}>这不是“一刀切”</div>
          <div style={{ fontSize: 44, lineHeight: 1.06, fontWeight: 950 }}>
            有高危因素
            <br />
            要尽快线下评估
          </div>
        </div>
      </PopIn>
    </div>
  );
};

const HeartBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 330], [1.1, 1.18]);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: SAFE.top,
        width: SAFE.contentRight,
        height: SAFE.titleY - SAFE.top,
        overflow: "hidden",
        opacity: 0.46,
        zIndex: 1,
      }}
    >
      <Loop durationInFrames={204}>
        <OffthreadVideo
          src={staticFile("fangchan-1.mp4")}
          muted
          style={{
            position: "absolute",
            left: 230,
            top: 90,
            width: 980,
            height: 552,
            transform: `scale(${scale}) rotate(-2deg)`,
            transformOrigin: "center",
            filter: "saturate(1.05) contrast(1.15)",
          }}
        />
      </Loop>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 72% 36%, rgba(37,99,235,0.18), transparent 36%), linear-gradient(90deg, rgba(7,16,22,0.44), rgba(7,16,22,0.12))",
        }}
      />
    </div>
  );
};

const RealSubtitle: React.FC = () => {
  const frame = useCurrentFrame();
  const text =
    frame < 120
      ? "低密度胆固醇到 3.7，\n先别急着自己下结论。"
      : frame < 242
        ? "它不是只看一个数字，\n要看你有没有高危因素。"
        : "如果有冠心病、糖尿病，\n带着化验单线下评估。";
  return (
    <div
      style={{
        position: "absolute",
        left: 54,
        top: SAFE.subtitleY + 38,
        width: SAFE.rightRailX - 96,
        minHeight: 132,
        zIndex: 18,
        color: "#FFFFFF",
        fontFamily: F.sans,
        fontSize: 45,
        lineHeight: 1.18,
        fontWeight: 950,
        textAlign: "center",
        whiteSpace: "pre-line",
        textShadow:
          "0 4px 0 rgba(0,0,0,0.92), 0 -2px 0 rgba(0,0,0,0.92), 2px 0 0 rgba(0,0,0,0.92), -2px 0 0 rgba(0,0,0,0.92), 0 10px 26px rgba(0,0,0,0.82)",
      }}
    >
      {text}
    </div>
  );
};

const MotionPlanBadges: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 412,
        top: 454,
        width: 450,
        height: 74,
        zIndex: 10,
        display: "flex",
        gap: 10,
        alignItems: "center",
      }}
    >
      {[
        { label: "化验单", active: frame >= 42 },
        { label: "红框", active: frame >= 110 },
        { label: "风险判断", active: frame >= 160 },
      ].map((item) => (
        <div
          key={item.label}
          style={{
            padding: "9px 16px",
            borderRadius: 999,
            background: item.active ? "rgba(34,211,238,0.18)" : "rgba(255,255,255,0.08)",
            border: `1px solid ${item.active ? "rgba(34,211,238,0.5)" : "rgba(255,255,255,0.12)"}`,
            color: item.active ? "#A5F3FC" : "rgba(255,255,255,0.42)",
            fontFamily: F.sans,
            fontSize: 20,
            fontWeight: 850,
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
};

const NumberCallout: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 74) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 430,
        top: 452,
        width: 410,
        zIndex: 8,
        display: "flex",
        alignItems: "baseline",
        justifyContent: "center",
        gap: 14,
        color: "#FFFFFF",
        fontFamily: F.sans,
        height: 70,
        padding: "0 22px",
        borderRadius: 999,
        background: "rgba(2,6,23,0.62)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.32)",
      }}
    >
      <span style={{ fontSize: 28, fontWeight: 900, color: C.ink }}>LDL-C</span>
      <CountUp
        startFrame={74}
        durationFrames={28}
        from={0}
        to={3.7}
        format={(n) => n.toFixed(1)}
        style={{
          color: C.amber,
          fontSize: 58,
          fontFamily: F.num,
          fontWeight: 950,
          lineHeight: 1,
        }}
      />
      <span style={{ fontSize: 23, fontWeight: 850, color: C.inkSoft }}>mmol/L</span>
    </div>
  );
};

export const PlatformSafeDemo: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(150deg, #08111A 0%, #0F172A 46%, #071016 100%), radial-gradient(circle at 64% 34%, rgba(14,165,233,0.22), transparent 32%)",
      }}
    />
    <HeartBackdrop />
    <TopQuestion />
    <NumberCallout />
    <LabReport />
    <EvidenceBoard />
    <Verdict />
    <DoctorLeft />
    <RealSubtitle />
    <SafeAreaOverlay />
  </AbsoluteFill>
);
