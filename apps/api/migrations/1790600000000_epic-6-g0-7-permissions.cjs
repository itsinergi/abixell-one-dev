/**
 * Epic 6 Gelombang 0 — Product Core permissions (7/8).
 *
 * Capability-based permissions for Business Partner, Contact, Address, and
 * Tax Registration CRUD, plus sensitive Employee Profile read (separate from
 * generic workforce.read to prevent unintended disclosure).
 *
 * Permission naming convention: `resource.action` or `resource.sub.action`.
 *
 * These are the permissions; actual role assignments and fine-grained scope
 * filtering happen in the service and route layers.
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('business_partner.create', 'Create a new Business Partner (party canonical)'),
        ('business_partner.read', 'View Business Partner records (subject to Data Scope)'),
        ('business_partner.update', 'Modify Business Partner details and lifecycle status'),
        ('business_partner.delete', 'Hard-delete or tombstone Business Partner records'),
        ('business_partner.activate', 'Transition Business Partner from draft to active'),
        ('business_partner.deactivate', 'Transition Business Partner to inactive or tombstone'),

        ('bp_role.create', 'Assign a role (employee/customer/vendor/etc.) to a Business Partner'),
        ('bp_role.read', 'View Business Partner role assignments'),
        ('bp_role.update', 'Modify role status (active/inactive)'),
        ('bp_role.delete', 'Remove a role from a Business Partner'),

        ('bp_contact.create', 'Create Contact under a Business Partner (Organization only)'),
        ('bp_contact.read', 'View Business Partner Contacts'),
        ('bp_contact.update', 'Modify Contact details and lifecycle status'),
        ('bp_contact.delete', 'Remove or deactivate a Contact'),
        ('bp_contact.link_user', 'Link a Contact to a platform User account'),

        ('bp_address.create', 'Add an address to a Business Partner'),
        ('bp_address.read', 'View Business Partner addresses'),
        ('bp_address.update', 'Modify address details and effective dating'),
        ('bp_address.delete', 'Deactivate or remove an address'),

        ('tax_registration.create', 'Register a tax identifier (NPWP, NITKU, VAT, etc.)'),
        ('tax_registration.read', 'View tax registrations'),
        ('tax_registration.update', 'Modify tax registration details and effective dating'),
        ('tax_registration.delete', 'Deactivate or remove a tax registration'),
        ('tax_registration.verify', 'Mark a tax registration as verified or rejected'),

        ('employee_profile.read', 'View Employee Profile details (sensitive, separate from workforce.read)'),
        ('employee_profile.manage', 'Create and maintain Employee Profiles'),

        ('organization_unit.change_request.create', 'Propose organizational structure changes (Wave 2 change request)'),
        ('organization_unit.change_request.review', 'Review and publish organizational structure change proposals'),
        ('organization_unit.tombstone', 'Mark an Organization Unit as deleted (reference census maintained)')
      ) AS v(code, description)
     ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM permissions
     WHERE code IN (
       'business_partner.create', 'business_partner.read', 'business_partner.update', 'business_partner.delete',
       'business_partner.activate', 'business_partner.deactivate',
       'bp_role.create', 'bp_role.read', 'bp_role.update', 'bp_role.delete',
       'bp_contact.create', 'bp_contact.read', 'bp_contact.update', 'bp_contact.delete', 'bp_contact.link_user',
       'bp_address.create', 'bp_address.read', 'bp_address.update', 'bp_address.delete',
       'tax_registration.create', 'tax_registration.read', 'tax_registration.update', 'tax_registration.delete', 'tax_registration.verify',
       'employee_profile.read', 'employee_profile.manage',
       'organization_unit.change_request.create', 'organization_unit.change_request.review', 'organization_unit.tombstone'
     )
  `);
};
