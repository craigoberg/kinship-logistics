-- =============================================================================
-- 2026-08-10 — Public CMS content pack v1 (BL-110 — content first)
-- =============================================================================
--
-- Refreshes published page copy for yada.org.au / /public/*.
-- Safe to re-run. Does not touch branding (logo/favicon/colours = BL-113).
-- Phone/street: left as OFFICE PLACEHOLDERS — replace in Admin → Public website
--   or edit the contact page after you confirm public contact details.
--
-- Prerequisite: docs/sql/2026-08-10_public_cms_and_forms.sql
-- "Success. No rows returned" is normal for UPDATE-only scripts.
-- =============================================================================

-- Ensure pages exist (fresh DB) then overwrite bodies
INSERT INTO public.cms_pages (slug, title, summary, body_blocks, nav_label, nav_order, status, published_at)
VALUES
  ('home', 'Welcome to YADA', 'Young Adults Disabled Association', '[]'::jsonb, 'Home', 10, 'published', now()),
  ('about', 'About us', 'Who we are', '[]'::jsonb, 'About', 20, 'published', now()),
  ('services', 'Services', 'What we offer', '[]'::jsonb, 'Services', 30, 'published', now()),
  ('how-to-join', 'How to join', 'Starting with YADA', '[]'::jsonb, 'How to join', 40, 'published', now()),
  ('policies', 'Policies', 'Public policy set', '[]'::jsonb, 'Policies', 50, 'published', now()),
  ('contact', 'Contact', 'Get in touch', '[]'::jsonb, 'Contact', 60, 'published', now()),
  ('forms', 'Forms', 'Rights and voice', '[]'::jsonb, 'Forms', 70, 'published', now()),
  ('easy-read', 'Easy Read', 'Short Easy Read pages', '[]'::jsonb, 'Easy Read', 80, 'published', now())
ON CONFLICT (slug) DO NOTHING;

UPDATE public.cms_pages SET
  title = 'Welcome to YADA',
  summary = 'Young Adults Disabled Association — day centre and community supports',
  nav_label = 'Home',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "hero",
      "headline": "Day centre and community supports for young adults with disability",
      "sub": "Young Adults Disabled Association Inc (YADA) — south-west Sydney. Enquiries, feedback and complaints can be made online.",
      "ctas": [
        {"label": "How to join", "href": "/public/how-to-join"},
        {"label": "Contact us", "href": "/public/contact"},
        {"label": "Make a complaint", "href": "/public/forms/complaint"}
      ]
    },
    {
      "type": "richtext",
      "html": "<h2>What we do</h2><p>YADA runs day centre programs and community access supports so participants can build skills, friendship and independence in everyday settings.</p><ul><li><strong>Day centre</strong> — structured days with activities, meals support and routines agreed in each person’s care profile.</li><li><strong>Community and outings</strong> — planned trips and weekend activities where support and transport are arranged with families and nominees.</li><li><strong>Rights and voice</strong> — you can enquire, give feedback, say thank you, express interest in volunteering, or make a complaint (including anonymously).</li></ul><p><a href=\"/public/services\">See services</a> · <a href=\"/public/forms\">Open forms</a></p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'home';

UPDATE public.cms_pages SET
  title = 'About us',
  summary = 'Who we are and how Connect fits',
  nav_label = 'About',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<p><strong>Young Adults Disabled Association Inc (YADA)</strong> is an NDIS provider supporting young adults with disability through day centre and community programs.</p><h2>Our focus</h2><p>We work with participants, families and nominees to deliver safe, respectful supports that match each person’s goals and care profile — including allergies, communication needs and transport arrangements.</p><h2>Two websites</h2><ul><li><strong>yada.org.au</strong> (this site) — public information, policies and rights &amp; voice forms.</li><li><strong>connect.yada.org.au</strong> — YADA Connect, our operations CRM used by staff for day-to-day delivery, onboarding and governance. It is not a public signup portal.</li></ul><p>If you want to start a conversation about joining YADA, use <a href=\"/public/forms/enquiry\">General enquiry</a> or <a href=\"/public/contact\">Contact</a>.</p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'about';

UPDATE public.cms_pages SET
  title = 'Services',
  summary = 'Day centre, community access and outings',
  nav_label = 'Services',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<h2>Day centre</h2><p>Our Bonnyrigg day centre provides structured program days. Supports are planned against each participant’s profile (including health, medication context where relevant, and daily living needs).</p><h2>Community access and outings</h2><p>Community outings and selected weekend trips are arranged through planning with participants and nominees. Transport may be provided on scheduled runs. Suitability depends on support needs, staffing and the outing risk assessment.</p><h2>Workforce and volunteers</h2><p>Paid staff and volunteers are inducted through YADA Connect. If you are interested in volunteering, use the <a href=\"/public/forms/volunteer_eoi\">Volunteer expression of interest</a> form — our office will follow up.</p><p>Eligibility, funding and start dates are always confirmed with the office — not automatically online.</p><p><a href=\"/public/how-to-join\">How to join</a></p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'services';

UPDATE public.cms_pages SET
  title = 'How to join',
  summary = 'Starting supports with YADA',
  nav_label = 'How to join',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<p>Joining YADA is done with our office — not by creating an online account.</p><ol><li><strong>Enquire</strong> — send a <a href=\"/public/forms/enquiry\">general enquiry</a> (or phone/email the centre). Tell us about the participant and what support you are looking for.</li><li><strong>Office conversation</strong> — we discuss eligibility, NDIS funding context, availability and whether YADA is a good fit.</li><li><strong>Client onboarding</strong> — intake is completed in YADA Connect: online form → print → wet-sign → file. Reviews are due every 12 months, or sooner when circumstances change.</li></ol><p>Accompanying persons and workforce (staff/volunteers) use separate onboarding packs managed by the office.</p><p><a href=\"/public/contact\">Contact us</a> · <a href=\"/public/forms/enquiry\">Send an enquiry</a></p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'how-to-join';

UPDATE public.cms_pages SET
  title = 'Policies',
  summary = 'Public policy information',
  nav_label = 'Policies',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<p>YADA maintains policies aligned with NDIS Practice Standards and participant rights. The list below is our public set. Full procedures are held in the office library (SharePoint when linked).</p><h2>Public policy topics</h2><ul><li>Privacy</li><li>Complaints</li><li>Incident management (summary)</li><li>Code of conduct (public)</li><li>NDIS participant rights</li></ul><p><strong>PDF links:</strong> Approved public PDFs will be added here by the office (Admin → Public website → Media, then link from this page). Until then, ask the office for the current document, or use the <a href=\"/public/forms/complaint\">complaint form</a> / <a href=\"/public/forms/enquiry\">enquiry form</a>.</p><p>Making a complaint does not require you to read every policy first — use <a href=\"/public/forms/complaint\">Make a complaint</a> whenever you need to.</p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'policies';

UPDATE public.cms_pages SET
  title = 'Contact',
  summary = 'Get in touch with YADA',
  nav_label = 'Contact',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<p>We are based at our Bonnyrigg day centre (south-west Sydney).</p><p><strong>Public contact details — office to confirm</strong></p><ul><li>Phone: <em>[insert public phone]</em></li><li>Email: <em>[insert public email]</em></li><li>Street address: <em>[insert public address]</em></li><li>Hours: <em>[insert operating hours]</em></li></ul><p>Prefer to write online? Use the enquiry form below. For complaints (including anonymous), use <a href=\"/public/forms/complaint\">Make a complaint</a>.</p>"
    },
    {"type": "form", "formKey": "enquiry"}
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'contact';

UPDATE public.cms_pages SET
  title = 'Forms',
  summary = 'Rights and voice forms',
  nav_label = 'Forms',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<p>These forms go to YADA’s Governance Hub so the office can respond. They are not sent by email alone.</p><ul><li><strong>Complaint</strong> — you may stay anonymous.</li><li><strong>Enquiry</strong> — questions about joining or supports.</li><li><strong>Feedback</strong> — how we can improve (anonymous OK).</li><li><strong>Compliment</strong> — tell us what went well.</li><li><strong>Volunteer EOI</strong> — interest in volunteering; office follows up.</li></ul><p>Choose a form below.</p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'forms';

UPDATE public.cms_pages SET
  title = 'Easy Read',
  summary = 'Short Easy Read information',
  nav_label = 'Easy Read',
  status = 'published',
  published_at = COALESCE(published_at, now()),
  body_blocks = $json$[
    {
      "type": "richtext",
      "html": "<p>This page uses short sentences.</p><h2>Who we are</h2><p>YADA helps young adults with disability.</p><p>We have a day centre. We also go into the community.</p><h2>Talk to us</h2><p>You can ask a question.</p><p>You can say thank you.</p><p>You can make a complaint.</p><p>You do not have to give your name to make a complaint.</p><p><a href=\"/public/forms/enquiry\">Ask a question</a></p><p><a href=\"/public/forms/complaint\">Make a complaint</a></p><p><a href=\"/public/forms/compliment\">Say thank you</a></p><h2>More Easy Read</h2><p>More Easy Read pages will be added later. Ask staff if you need help.</p>"
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'easy-read';

-- Keep nav in sync if empty or refresh labels/order
INSERT INTO public.cms_nav (label, href, sort_order, visible)
SELECT v.label, v.href, v.sort_order, v.visible
FROM (VALUES
  ('Home', '/public', 10, true),
  ('About', '/public/about', 20, true),
  ('Services', '/public/services', 30, true),
  ('How to join', '/public/how-to-join', 40, true),
  ('Policies', '/public/policies', 50, true),
  ('Contact', '/public/contact', 60, true),
  ('Forms', '/public/forms', 70, true),
  ('Easy Read', '/public/easy-read', 80, true)
) AS v(label, href, sort_order, visible)
WHERE NOT EXISTS (SELECT 1 FROM public.cms_nav LIMIT 1);

UPDATE public.cms_nav n SET
  label = v.label,
  sort_order = v.sort_order,
  visible = true,
  updated_at = now()
FROM (VALUES
  ('Home', '/public', 10),
  ('About', '/public/about', 20),
  ('Services', '/public/services', 30),
  ('How to join', '/public/how-to-join', 40),
  ('Policies', '/public/policies', 50),
  ('Contact', '/public/contact', 60),
  ('Forms', '/public/forms', 70),
  ('Easy Read', '/public/easy-read', 80)
) AS v(label, href, sort_order)
WHERE n.href = v.href;

NOTIFY pgrst, 'reload schema';

-- Validation (expect 8 rows, contact html contains OFFICE placeholder text):
-- SELECT slug, title, status, left(body_blocks::text, 80) AS body_start
-- FROM public.cms_pages
-- ORDER BY nav_order;
-- Expect: home, about, services, how-to-join, policies, contact, forms, easy-read — all published.
