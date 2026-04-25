FROM google/cloud-sdk:alpine

# Install bash for better script support
RUN apk add --no-cache bash

# Copy the shutdown script
COPY shutdown.sh /shutdown.sh
RUN chmod +x /shutdown.sh

# Run the shutdown script
ENTRYPOINT ["/shutdown.sh"]
