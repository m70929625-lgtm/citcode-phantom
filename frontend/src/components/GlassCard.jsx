export default function GlassCard({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`
        premium-panel rounded-[30px] backdrop-blur-2xl
        ${hover ? 'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_35px_90px_rgba(15,23,42,0.14)]' : ''}
        ${className}
      `}
      {...props}
    >
      <div className="relative z-[1]">
        {children}
      </div>
    </div>
  );
}
