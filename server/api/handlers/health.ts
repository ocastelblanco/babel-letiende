import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

/**
 * Endpoint mínimo de verificación (`GET /api/health`).
 *
 * Placeholder sin lógica de negocio ni dependencias de DynamoDB: solo
 * confirma que la Lambda `api` y el API Gateway están correctamente
 * desplegados de punta a punta.
 */
export const handler: APIGatewayProxyHandlerV2 = async (): Promise<APIGatewayProxyResultV2> => {
  const cuerpoRespuesta = { estado: 'ok' };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpoRespuesta),
  };
};
