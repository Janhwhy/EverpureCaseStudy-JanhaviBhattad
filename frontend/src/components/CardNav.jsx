// Adapted from React Bits "CardNav" (https://reactbits.dev, MIT): same GSAP expand/stagger animation,
// with router links, left/centre/right slots instead of the logo and CTA, and Escape to close.
import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import './CardNav.css';

const ArrowUpRight = () => (
  <svg className="nav-card-link-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <path d="M4.5 11.5l7-7M6 4.5h5.5V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TOP_BAR = 64;

export default function CardNav({ items, left, center, right, ease = 'power3.out', baseColor = '#1b2632', menuColor = '#eee9df' }) {
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const navRef = useRef(null);
  const cardsRef = useRef([]);
  const tlRef = useRef(null);

  // Open height follows the cards' content (React Bits only measures on mobile and uses 260px on desktop).
  const calculateHeight = () => {
    const contentEl = navRef.current?.querySelector('.card-nav-content');
    if (!contentEl) return 270;
    const keys = ['visibility', 'pointerEvents', 'position', 'height'];
    const saved = keys.map((k) => contentEl.style[k]);
    Object.assign(contentEl.style, { visibility: 'visible', pointerEvents: 'auto', position: 'static', height: 'auto' });
    // offsetHeight, not scrollHeight: the cards start translated 50px down for the entrance animation,
    // and scrollHeight would count that offset as extra height.
    const contentHeight = contentEl.offsetHeight;
    keys.forEach((k, i) => { contentEl.style[k] = saved[i]; });
    return TOP_BAR + contentHeight;
  };

  // Built fresh on every open, from the height measured at that moment, so live content changes
  // between opens never leave a stale timeline behind.
  const createTimeline = () => {
    const navEl = navRef.current;
    const cards = cardsRef.current.filter(Boolean);
    gsap.set(navEl, { height: TOP_BAR });
    gsap.set(cards, { y: 50, opacity: 0 });
    const tl = gsap.timeline({ paused: true });
    tl.to(navEl, { height: calculateHeight(), duration: 0.4, ease });
    tl.to(cards, { y: 0, opacity: 1, duration: 0.4, ease, stagger: 0.08 }, '-=0.1');
    return tl;
  };

  useLayoutEffect(() => {
    gsap.set(navRef.current, { height: TOP_BAR, overflow: 'hidden' });
    return () => tlRef.current?.kill();
  }, []);

  // While open, keep the height matched to the content (live numbers load in, window resizes).
  useLayoutEffect(() => {
    // Only once the open animation has finished, so this never fights the tween.
    if (!isExpanded || !tlRef.current || tlRef.current.progress() < 1 || tlRef.current.reversed()) return undefined;
    const fit = () => gsap.set(navRef.current, { height: calculateHeight() });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  const open = () => {
    tlRef.current?.kill();
    tlRef.current = createTimeline();
    setIsHamburgerOpen(true);
    setIsExpanded(true);
    tlRef.current.eventCallback('onComplete', () => gsap.set(navRef.current, { height: calculateHeight() }));
    tlRef.current.play(0);
  };

  const close = () => {
    const tl = tlRef.current;
    if (!tl || !isExpanded) return;
    setIsHamburgerOpen(false);
    tl.eventCallback('onReverseComplete', () => setIsExpanded(false));
    tl.reverse();
  };

  const toggleMenu = () => (isExpanded ? close() : open());

  useEffect(() => {
    if (!isExpanded) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  const setCardRef = (i) => (el) => {
    cardsRef.current[i] = el;
  };

  return (
    <div className="card-nav-container">
      <nav ref={navRef} className={`card-nav ${isExpanded ? 'open' : ''}`} style={{ backgroundColor: baseColor }} aria-label="Main">
        <div className="card-nav-top">
          <button
            type="button"
            className={`hamburger-menu ${isHamburgerOpen ? 'open' : ''}`}
            onClick={toggleMenu}
            aria-label={isExpanded ? 'Close menu' : 'Open menu'}
            aria-expanded={isExpanded}
            style={{ color: menuColor }}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-text">{isExpanded ? 'Close' : 'Menu'}</span>
          </button>
          {left}

          <div className="card-nav-center">{center}</div>

          <div className="card-nav-right">{right}</div>
        </div>

        <div className="card-nav-content" aria-hidden={!isExpanded}>
          {items.map((item, idx) => (
            <div key={item.label} className="nav-card" ref={setCardRef(idx)}
              style={{ backgroundColor: item.bgColor, color: item.textColor }}>
              <div className="nav-card-head">
                <div className="nav-card-label">{item.label}</div>
                <div className="nav-card-hint">{item.hint}</div>
              </div>
              {item.stat && (
                <div className="nav-card-stats">
                  {[].concat(item.stat).map((st) => (
                    <div key={st.label} className="nav-card-stat">
                      <b>{st.value ?? '—'}</b>
                      <span>{st.label}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="nav-card-links">
                {item.links.map((lnk) => (
                  <Link key={lnk.to} className={`nav-card-link ${lnk.active ? 'active' : ''}`} to={lnk.to}
                    onClick={close} tabIndex={isExpanded ? 0 : -1} aria-current={lnk.active ? 'page' : undefined}>
                    <ArrowUpRight />
                    <span className="nav-card-link-label">{lnk.label}</span>
                    {lnk.meta != null && <span className="nav-card-meta">{lnk.meta}</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
