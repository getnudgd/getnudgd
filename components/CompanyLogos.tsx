const COMPANIES = [
  "Razorpay",
  "Swiggy",
  "CRED",
  "Zepto",
  "PhonePe",
  "Groww",
  "Meesho",
  "Zomato",
  "Flipkart",
];

export function CompanyLogos() {
  return (
    <section className="logos reveal">
      <span className="label">Get referred into companies like</span>
      <div className="logos-row">
        {COMPANIES.map((company) => (
          <span key={company} className="logo-chip">
            {company}
          </span>
        ))}
        <span className="logo-chip more">+ 40 more</span>
      </div>
    </section>
  );
}
