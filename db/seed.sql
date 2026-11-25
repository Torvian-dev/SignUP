-- Platform-wide domain rules. Profiles and keys are created through the API/UI, because
-- encryption happens in the application layer (the DB never sees plaintext).

INSERT INTO domain_rules (org_id, domain, rule, reason) VALUES
  (NULL, 'gov.uk',            'allow', 'Public-sector portals'),
  (NULL, 'accounts.google.com','block', 'Identity provider – never automate'),
  (NULL, 'login.microsoftonline.com','block', 'Identity provider – never automate'),
  (NULL, 'paypal.com',        'block', 'Payment provider – never automate'),
  (NULL, 'stripe.com',        'block', 'Payment provider – never automate')
ON CONFLICT DO NOTHING;
