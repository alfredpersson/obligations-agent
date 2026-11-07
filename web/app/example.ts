// The example product of the start page: a candidate-matching tool, with its description by field
// id and its form answers by slot id (schema.yaml).
export const EXAMPLE = {
  description: {
    what_it_does:
      "Ranks candidates for an open job. A recruiter enters the job's requirements, and the product compares them with the CVs and profiles in the candidate database, lists the best matches with the parts of each CV that match, and writes a short summary of why each candidate matches.",
    who_uses_it:
      "Our own recruiters use it to find candidates for our clients' open jobs. The candidates do not use the product, but it ranks them.",
    data_it_handles:
      "CVs and profiles of job seekers: names, contact details, work history, education, skills and salary expectations. The requirements of each job, from the client companies.",
  },
  answers: { personal_data: "yes", under_own_name: "yes", use_case_area: "employment", own_use: "yes" },
};
