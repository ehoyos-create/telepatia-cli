/**
 * GraphQL documents, copied (and trimmed to what the CLI needs) from the
 * operations the official web app sends to the datalayer. Field names and
 * argument types must stay in sync with the server schema.
 */

export const SESSION_STATUSES = [
  "recording",
  "stopped",
  "allChunksReceived",
  "processing",
  "completed",
  "completedWithErrors",
  "reviewed",
  "error",
] as const;

export const TERMINAL_STATUSES = new Set(["completed", "completedWithErrors", "reviewed", "error", "cancelled", "deleted"]);

export const LIST_SESSIONS = /* GraphQL */ `
  query GetScribeSessionsList($filter: ScribeSessionFilterInput) {
    scribeSessions(filter: $filter) {
      id
      patientName
      createdAt
      completedAt
      status
      encounterKind
      scribePatientId
      patient {
        id
        fullName
      }
      scribeSessionConfiguration {
        id
        name
      }
      selectedTemplates {
        type
        id
        nameSnapshot
        isPrimary
      }
    }
  }
`;

export const COUNT_SESSIONS = /* GraphQL */ `
  query GetScribeSessionsCount($filter: ScribeSessionFilterInput) {
    scribeSessionsPage(filter: $filter) {
      totalCount
    }
  }
`;

export const GET_SESSION = /* GraphQL */ `
  query GetScribeSession($id: ID!) {
    scribeSession(id: $id) {
      id
      createdAt
      updatedAt
      completedAt
      status
      language
      accountId
      institutionId
      patientName
      scribePatientId
      encounterId
      isTelemedicine
      additionalContext
      scribeSessionConfigurationId
      medicalRecordConfigurationId
      scribeSessionConfiguration {
        id
      }
      patient {
        id
        fullName
        identifications {
          idValue
          idType
          country
        }
      }
      transcript
      transcriptStatus
      audioDurationWritten
      medicalRecordOrder
      medicalRecordMutable
      medicalRecordSummary
      suggestedCie11Codes
      effectiveDiagnosisCodes {
        primary {
          code
          description
        }
        secondary {
          code
          description
        }
      }
      hallucinationWarnings {
        sectionKey
        quotedText
        category
        reason
        confidence
      }
      selectedTemplates {
        type
        id
        nameSnapshot
        isPrimary
      }
      error
    }
  }
`;

export const GET_SESSION_STATUS = /* GraphQL */ `
  query GetSessionStatus($id: ID!) {
    scribeSession(id: $id) {
      id
      status
      pipelineStatus
      error
    }
  }
`;

export const DELETE_SESSION = /* GraphQL */ `
  mutation UpdateScribeSession($id: ID!, $input: UpdateScribeSessionInput!, $updateMode: UpdateMode) {
    updateScribeSession(id: $id, input: $input, updateMode: $updateMode) {
      id
      status
    }
  }
`;

export const MEDICAL_RECORD_DOCUMENTS = /* GraphQL */ `
  query MedicalRecordDocumentsBySession($scribeSessionId: ID!) {
    medicalRecordDocuments(filter: { scribeSessionId: $scribeSessionId, limit: 50 }) {
      totalCount
      medicalRecordDocuments {
        id
        purpose
        specialty
        language
        medicalRecord
        medicalRecordSummary
        medicalRecordConfiguration {
          id
        }
        createdAt
        updatedAt
      }
    }
  }
`;

export const GET_PATIENTS = /* GraphQL */ `
  query GetPatients($filter: GetPatientsFilter) {
    getPatients(filter: $filter) {
      totalCount
      patients {
        id
        fullName
        patientName
        lastConsultation
        lastSession {
          id
          createdAt
        }
        identifications {
          idValue
          idType
          country
        }
      }
    }
  }
`;

export const SEARCH_PATIENTS = /* GraphQL */ `
  query SearchScribePatients($query: String!, $limit: Int, $offset: Int) {
    searchScribePatients(query: $query, limit: $limit, offset: $offset) {
      id
      fullName
      patientName
      lastConsultation
      lastSession {
        id
        createdAt
      }
      identifications {
        idValue
        idType
        country
      }
    }
  }
`;

export const GET_PATIENT = /* GraphQL */ `
  query GetScribePatient($id: ID!) {
    scribePatient(id: $id) {
      id
      fullName
      patientName
      lastConsultation
      lastSession {
        id
        createdAt
      }
      identifications {
        idValue
        idType
        country
      }
      phoneNumbers {
        countryCode
        phoneNumber
      }
      emails {
        email
      }
      createdAt
      updatedAt
    }
  }
`;

export const PATIENT_TIMELINE = /* GraphQL */ `
  query GetTimelineByPatient($input: TimelineByPatientInput!) {
    timelineByPatient(input: $input) {
      patientId
      total
      sessions {
        id
        status
        createdAt
        medicalRecordSummary
        account {
          id
          nameFull
        }
      }
    }
  }
`;

export const UPSERT_PATIENT = /* GraphQL */ `
  mutation UpdateOrCreateScribePatient($input: UpdateOrCreateScribePatientInput!) {
    updateOrCreateScribePatient(input: $input) {
      id
      fullName
      identifications {
        idValue
        idType
        country
      }
    }
  }
`;

export const LIST_TEMPLATES = /* GraphQL */ `
  query GetScribeSessionConfigurations($filter: ScribeSessionConfigurationsFilter) {
    scribeSessionConfigurations(filter: $filter) {
      id
      publicId
      name
      type
      order
      description
      specialties
      isEditable
      personalized
      deletedAt
      updatedAt
    }
  }
`;

export const GET_TEMPLATE = /* GraphQL */ `
  query GetScribeSessionConfiguration($id: ID!) {
    scribeSessionConfiguration(id: $id) {
      id
      name
      description
      type
      specialties
      upperCase
      nodes {
        key
        order
        enabled
        hidden
        name {
          default
          es
          en
          pt
        }
        instruction {
          default
          es
          en
          pt
        }
      }
    }
  }
`;

