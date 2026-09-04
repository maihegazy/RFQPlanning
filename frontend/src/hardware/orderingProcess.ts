/**
 * The ordering process from the first sheet of the HW purchasing working document.
 *
 * That sheet held the flowchart as three pasted images, so it could not be searched,
 * linked to, or kept in step with the rest of the document. Modelling it as data lets
 * the module render it, and lets a step point at the screen that performs it.
 */

export type StepKind = 'terminator' | 'action' | 'decision'

export interface ProcessStep {
  id: string
  kind: StepKind
  label: string
  /** Who performs it, from the "Details & responsibilities" column. */
  owner?: string
  /** The verbatim guidance beside the step in the original chart. */
  detail?: string
  /** Decision branches, in the order they should read. */
  branches?: { label: string; to: string }[]
  /** Where this step happens in the app, when it happens in the app at all. */
  link?: { to: string; label: string }
}

export interface ProcessPhase {
  number: number
  title: string
  steps: ProcessStep[]
}

export const ORDERING_PROCESS: ProcessPhase[] = [
  {
    number: 1,
    title: 'Project HW budgeting',
    steps: [
      { id: 'start', kind: 'terminator', label: 'Start' },
      {
        id: 'needs',
        kind: 'action',
        label: 'Define the overall hardware needs',
        owner: 'Project lead',
        detail:
          'Specify the overall hardware needs and budget after confirming with the customer who will be handling which part of the purchasing, and after checking the guideline HW sheet for contact persons and prices.',
        link: { to: '/hardware-catalog', label: 'Hardware catalog' },
      },
      {
        id: 'budget',
        kind: 'action',
        label: 'Define the overall hardware budget',
        owner: 'Project lead',
      },
      {
        id: 'budget-approval',
        kind: 'decision',
        label: 'Approval on overall budget?',
        owner: 'Project lead',
        detail: 'Loop until getting an approval on the overall budget from the delivery director.',
        branches: [
          { label: 'Yes', to: 'budget-sheet' },
          { label: 'No', to: 'budget' },
        ],
      },
      {
        id: 'budget-sheet',
        kind: 'action',
        label: 'Project hardware budget sheet update',
        owner: 'Project lead',
        detail: 'Update the hardware budget sheet with the approved budget.',
        link: { to: '/hardware', label: 'Project budget' },
      },
    ],
  },
  {
    number: 2,
    title: 'Project HW purchasing',
    steps: [
      {
        id: 'annual-needs',
        kind: 'action',
        label: 'Define current annual hardware needs',
        owner: 'Project lead',
        detail:
          "Define current annual hardware needs. If the customer will handle purchasing, proceed directly to 'Check the received hardware and install needed license'.",
      },
      {
        id: 'who-purchases',
        kind: 'decision',
        label: 'Will Vehiclevo handle purchasing?',
        branches: [
          { label: 'Yes', to: 'guideline-sheet' },
          { label: 'No', to: 'receive' },
        ],
      },
      {
        id: 'guideline-sheet',
        kind: 'action',
        label: 'Check guideline HW sheet for contact persons and prices',
        owner: 'Project lead',
        detail:
          'Check the guideline hardware sheet for contact persons and prices. Next, request quotations and proceed with supplier selection according to specific criteria.',
        link: { to: '/hardware-catalog', label: 'Hardware catalog' },
      },
      { id: 'quotation', kind: 'action', label: 'Supplier quotation request', owner: 'Project lead' },
      { id: 'selection', kind: 'action', label: 'Supplier selection', owner: 'Project lead' },
      {
        id: 'order-email',
        kind: 'action',
        label: 'Send e-mail to purchasing team with order details',
        owner: 'Project lead and supplier manager',
        detail:
          'Contact the supplier team to finalize the procurement process according to the supplier management process and fulfill all necessary procurement approvals according to procurement standards. If not all approvals are met, escalate to the delivery director. If not approved, the purchasing process has come to an end.',
      },
      {
        id: 'approvals',
        kind: 'decision',
        label: 'Have all the procurement approvals been fulfilled?',
        branches: [
          { label: 'Yes', to: 'receive' },
          { label: 'No', to: 'escalate' },
        ],
      },
      { id: 'escalate', kind: 'action', label: 'Escalate to delivery director' },
      {
        id: 'escalation-approved',
        kind: 'decision',
        label: 'Approved?',
        branches: [
          { label: 'Yes', to: 'receive' },
          { label: 'No', to: 'end' },
        ],
      },
    ],
  },
  {
    number: 3,
    title: 'HW receiving and labeling',
    steps: [
      {
        id: 'receive',
        kind: 'action',
        label: 'Check the received hardware and install needed license',
        owner: 'Project lead and supplier manager',
        detail:
          'In case of a HW delivery it should be checked by the requester for conformance with the requirements. In case of non-conformance, feedback to the supplier is communicated and a return or replacement arranged if needed.',
      },
      { id: 'label', kind: 'action', label: 'Add labels and tags', owner: 'IT team' },
      {
        id: 'update-sheet',
        kind: 'action',
        label: 'Update the HW register with the spend',
        owner: 'Project lead',
        detail:
          'Install hardware and licenses, deliver to the IT team for labeling, and record the purchase against the project budget.',
        link: { to: '/hardware', label: 'Hardware projects' },
      },
      {
        id: 'snipeit',
        kind: 'action',
        label: 'Update Snipe-IT as per HW_Management_Process',
        owner: 'HW Manager (under PL supervision)',
        detail: 'Update Snipe-IT for tracking and management according to HW_Management_Process.',
      },
      { id: 'end', kind: 'terminator', label: 'End' },
    ],
  },
]
