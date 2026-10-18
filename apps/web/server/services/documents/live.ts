import 'server-only';
import { getDocumentStorage } from '../../storage';
import { documentServices } from '.';
import { documentAgentServices } from './agent';

export const { createDocument, uploadCv, attachSignedInvoice } =
  documentServices(getDocumentStorage);

export const { deleteReplacedDocument } = documentAgentServices(getDocumentStorage);
