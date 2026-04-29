const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Product prices — must match your site exactly
const PRICES = {
  1: { name: 'Pet Eye Wipes',           price: 1100 }, // $11.00 in cents
  2: { name: 'Paw Cleaner Foam',        price: 1200 },
  3: { name: 'Pet Teeth Wipes',         price: 1100 },
  4: { name: 'Chin Blackhead Wipes',    price: 1100 },
  5: { name: 'Pet Grooming Wipes',      price: 1200 },
};

function bundlePrice(qty) {
  if (qty >= 5) return 3500;
  if (qty >= 4) return 2500;
  if (qty >= 3) return 2000;
  return null;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { items } = JSON.parse(event.body);

    if (!items || items.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cart is empty' }) };
    }

    // Calculate total quantity for bundle pricing
    const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
    const bundleTotal = bundlePrice(totalQty);

    let lineItems;

    if (bundleTotal) {
      // Bundle deal — charge the bundle price as one line item
      const itemNames = items.map(item => {
        const p = PRICES[item.id];
        return `${p ? p.name : 'Item'} ×${item.qty}`;
      }).join(', ');

      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `🎉 Bundle Deal (${totalQty} items)`,
            description: itemNames,
          },
          unit_amount: bundleTotal,
        },
        quantity: 1,
      }];
    } else {
      // Regular pricing — one line item per product
      lineItems = items.map(item => {
        const p = PRICES[item.id];
        return {
          price_data: {
            currency: 'usd',
            product_data: {
              name: p ? p.name : `Product #${item.id}`,
            },
            unit_amount: p ? p.price : 1100,
          },
          quantity: item.qty,
        };
      });
    }

    const origin = event.headers.origin || event.headers.referer || 'https://wonitany.com';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'BE', 'AT', 'CH', 'JP', 'SG', 'HK'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 0, currency: 'usd' },
            display_name: 'Standard Shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 7 },
              maximum: { unit: 'business_day', value: 14 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 995, currency: 'usd' },
            display_name: 'Express Shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],
      success_url: `https://wonitany.com/?order=success`,
      cancel_url:  `https://wonitany.com/?order=cancelled`,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Payment setup failed. Please try again.' }),
    };
  }
};
