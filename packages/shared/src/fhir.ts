// FHIR type stubs. Minimal shapes used by the prototype data service
// and demo modules. Real implementations will replace these with
// generated types from the FHIR R4 spec; until then, modules should
// import from `@emr/shared` rather than redefining their own.
//
// Every resource carries the FHIR-standard `resourceType` discriminator
// plus a string `id`. Resources that need clinical detail (Observation
// codings, Encounter periods, etc.) are kept narrow on purpose — adding
// fields later is easy; removing them once modules rely on them is not.

export interface HumanName {
  readonly given: readonly string[];
  readonly family: string;
}

export interface FhirResource {
  readonly resourceType: string;
  readonly id: string;
}

export interface Patient extends FhirResource {
  readonly resourceType: 'Patient';
  readonly name: HumanName;
  readonly birthDate?: string;
  readonly gender?: 'male' | 'female' | 'other' | 'unknown';
}

export interface Practitioner extends FhirResource {
  readonly resourceType: 'Practitioner';
  readonly name: HumanName;
}

export interface Reference {
  readonly reference: string;
  readonly display?: string;
}

export interface Encounter extends FhirResource {
  readonly resourceType: 'Encounter';
  readonly subject: Reference;
  readonly status: 'planned' | 'in-progress' | 'finished' | 'cancelled';
  readonly period?: { readonly start: string; readonly end?: string };
}

export interface Observation extends FhirResource {
  readonly resourceType: 'Observation';
  readonly subject: Reference;
  readonly code: string;
  readonly value?: string | number;
  readonly effectiveDateTime?: string;
}
