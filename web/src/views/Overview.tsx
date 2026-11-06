export function Overview() {
  return (
    <div className="page overview">
      <div className="overview-inner">
        <div className="project-byline"><span>Independent project / Arthur Gaspar</span><span>São Caetano do Sul, SP</span></div>
        <section className="project-intro">
          <div>
            <p className="eyebrow">Urban mobility · delivery operations</p>
            <h1>One city.<br />Many ways<br />to <em>get there.</em></h1>
            <p className="intro-copy">Explore where São Paulo’s bus network reaches. Then build a delivery plan across the city and the Grande ABC.</p>
            <div className="intro-actions">
              <a className="primary" href="#optimizer">Try the route optimizer <span aria-hidden="true">↗</span></a>
              <a className="text-link" href="#insights">Explore the transit atlas →</a>
            </div>
          </div>
          <div className="route-print" aria-label="Schematic delivery loop from a São Caetano hub through São Paulo and back. Illustration, not a calculated route." role="img">
            <div className="print-heading"><span>SP / ABC</span><span>FIELD NOTES — 01</span></div>
            <svg viewBox="0 0 480 360" aria-hidden="true">
              <defs><pattern id="street-grid" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="currentColor" strokeWidth="0.6" /></pattern></defs>
              <rect width="480" height="360" fill="url(#street-grid)" opacity="0.22" />
              <path d="M345 0 C270 95 340 165 240 230 S215 305 175 360" className="print-river" />
              <path d="M40 290 L180 95 L278 70 L410 235 L310 290 Z" className="print-baseline" />
              <path d="M310 290 L410 235 L278 70 L180 95 L40 290 Z" className="print-route" />
              {[[40,290],[180,95],[278,70],[410,235]].map(([x,y], i) => <g key={i}><circle cx={x} cy={y} r="8" className="print-stop" /><text x={x + 15} y={y - 14}>0{i + 1}</text></g>)}
              <rect x="300" y="280" width="20" height="20" className="print-hub" />
              <text x="157" y="46" className="print-place">SÃO PAULO</text>
              <text x="257" y="329" className="print-place">SÃO CAETANO DO SUL</text>
            </svg>
            <div className="print-caption"><span><i /> Delivery loop</span><span>Schematic / not to scale</span></div>
          </div>
        </section>
        <section className="project-context">
          <div><p className="eyebrow">The context</p><h2>Local geography.<br />Practical engineering.</h2></div>
          <div>
            <p>I’m Arthur, a full-stack developer based in São Caetano do Sul. My work at Shippify involved logistics dashboards and routing systems; my research at UFABC involved Python data pipelines and scientific dashboards.</p>
            <p>This independent project brings those experiences together using public data. The atlas studies scheduled transit access. The optimizer tests delivery plans against a simple dispatch baseline. They share a geography, but answer different questions.</p>
            <a className="text-link" href="https://github.com/ArthurGaspar">More of my work ↗</a>
          </div>
        </section>
        <section className="project-chapters" aria-label="Explore the project">
          <a href="#optimizer" className="chapter"><span className="chapter-number">01 / INTERACT</span><h2>A delivery plan you can inspect.</h2><p>Change capacity, shift length, and stops. Compare the result with nearest-neighbor dispatch and export the plan.</p><span className="text-link">Open the optimizer ↗</span></a>
          <a href="#insights" className="chapter"><span className="chapter-number">02 / EXPLORE</span><h2>Read the network, area by area.</h2><p>Inspect peak-hour service and distance to stops. Focus on the São Paulo side of the ABC border.</p><span className="text-link">Open the atlas ↗</span></a>
          <a href="#model" className="chapter"><span className="chapter-number">03 / EXAMINE</span><h2>The assumptions are part of the result.</h2><p>See what the timetable measures, why GPS is a separate model, and where these estimates fall short.</p><span className="text-link">Read the method ↗</span></a>
        </section>
        <section className="engineering-note">
          <p className="eyebrow">Under the hood</p>
          <h2>Python builds the data.<br />The browser does the planning.</h2>
          <p>A typed React interface, a routing solver in a Web Worker, and a Python pipeline deployed through GitHub Actions. Delivery files are processed locally. No application server is needed.</p>
          <a className="text-link" href="https://github.com/ArthurGaspar/sp-transit-logistics#engineering-decisions">Read the engineering decisions ↗</a>
        </section>
        <footer className="project-footer"><span>Built by Arthur Gaspar · Independent portfolio project</span><span>SPTrans / IBGE / OpenStreetMap</span></footer>
      </div>
    </div>
  );
}
