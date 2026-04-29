const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const ECWID_STORE_ID = '135312258';
const ECWID_TOKEN   = process.env.ECWID_SECRET_TOKEN;

// Map product names back to SKUs
const SKU_MAP = {
  'Pet Eye Wipes':         'WON-001',
  'Paw Cleaner Foam':      'WON-002',
  'Pet Teeth Wipes':       'WON-003',
  'Chin Blackhead Wipes':  'WON-004',
  'Pet Grooming Wipes':    'WON-005',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify Stripe signature
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only handle successful payments
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = stripeEvent.data.object;

  // Only process paid orders
  if (session.payment_status !== 'paid') {
    return { statusCode: 200, body: 'Not paid yet' };
  }

  try {
    // Get full session with line items
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items'],
    });

    const shipping = fullSession.shipping_details;
    const customer = fullSession.customer_details;
    const lineItems = fullSession.line_items.data;

    // Build Ecwid order items
    const ecwidItems = lineItems.map(item => {
      const sku = SKU_MAP[item.description] || SKU_MAP[item.description?.split(' ×')[0]] || 'WON-000';
      return {
        name: item.description || item.price?.product_data?.name || 'Product',
        quantity: item.quantity,
        price: (item.amount_total / 100) / item.quantity,
        sku: sku,
      };
    });

    // Build Ecwid order payload
    const ecwidOrder = {
      email: customer?.email || '',
      paymentMethod: 'Stripe',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'AWAITING_PROCESSING',
      total: fullSession.amount_total / 100,
      subtotal: fullSession.amount_subtotal / 100,
      shippingOption: {
        name: 'Standard Shipping',
      },
      shippingPerson: {
        name: shipping?.name || customer?.name || '',
        street: shipping?.address?.line1 || '',
        city: shipping?.address?.city || '',
        stateOrProvinceCode: shipping?.address?.state || '',
        postalCode: shipping?.address?.postal_code || '',
        countryCode: shipping?.address?.country || 'US',
      },
      items: ecwidItems,
      referenceTransactionId: session.payment_intent,
    };

    // POST order to Ecwid
    const ecwidRes = await fetch(
      `https://app.ecwid.com/api/v3/${ECWID_STORE_ID}/orders?token=${ECWID_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecwidOrder),
      }
    );

    const ecwidData = await ecwidRes.json();

    if (!ecwidRes.ok) {
      console.error('Ecwid error:', ecwidData);
      return { statusCode: 500, body: 'Failed to create Ecwid order' };
    }

    console.log('Ecwid order created:', ecwidData.id);
    return { statusCode: 200, body: JSON.stringify({ ecwidOrderId: ecwidData.id }) };

  } catch (err) {
    console.error('Error creating Ecwid order:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
