# **Security and Privacy**

_Captured 2026-05-09_

**Access control & authentication**

- Implement role-based access control with least privilege
- Assign unique user IDs (no shared accounts)
- Require MFA for admins, remote access, and bulk-export accounts
- Enforce automatic session timeouts
- Build break-glass emergency access with mandatory logging

**Encryption**
- Enforce TLS 1.2+ for all connections (including internal)
- Encrypt data at rest with AES-256
- Store encryption keys separately in an HSM or KMS
- Rotate keys on a defined schedule
- Audit all access to encryption keys

**Audit logging**
- Log every read, write, export, and admin action on personal/health data
- Make logs tamper-evident (append-only or shipped to separate system)
- Retain security logs for at least 6 years
- Set up alerts for unusual access patterns

**Data subject / patient rights**
- Build a data export (portability) function
- Build a data deletion function that propagates to backups and analytics
- Build a data rectification (correction) function
- Build a processing restriction function
- Provide patient access to their own PHI
- Maintain an accounting of disclosures

**Breach detection & notification**
- Deploy SIEM or anomaly detection for fast breach identification

**Data minimization & retention**
- Collect only data needed for the stated purpose
- Define a retention period for every data category
- Automate deletion or anonymization at end of retention
- Pseudonymize or tokenize data where possible

**Third-party & vendor controls**
- Sign BAAs with every vendor touching PHI
- Sign DPAs with every processor handling personal data
- Maintain a list of sub-processors
- Document a legal basis for any cross-border data transfers

**Integrity & availability**
- Use checksums or signing to detect data tampering
- Run regular encrypted backups
- Test backup restoration on a defined schedule
- Document RTO and RPO for disaster recovery
- Maintain a written contingency plan

**Governance**
- Designate a HIPAA Privacy Officer
- Designate a HIPAA Security Officer
- Appoint a GDPR DPO if required
- Conduct and document a risk analysis (update annually)
- Maintain Records of Processing Activities (ROPAs)
- Run DPIAs for high-risk processing
- Track workforce security training completion

**Consent & lawful basis**
- Capture granular, withdrawable consent
- Propagate consent withdrawal to all downstream systems
- Record lawful basis for each processing activity

**Common gaps to close**
- Treat logs containing PHI as PHI (encrypt and restrict access)
- Replace real data in non-prod environments with synthetic data
- Verify "deleted" data is gone from backups, warehouses, and search indexes
- Lock down and audit customer support tools
- Audit third-party scripts on pages handling personal/health data
