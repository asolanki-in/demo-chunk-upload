package com.example.Subscriber;

import org.apache.activemq.artemis.jms.client.ActiveMQConnectionFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jms.config.DefaultJmsListenerContainerFactory;

@Configuration
public class JmsConfiguration {

    @Bean
    public DefaultJmsListenerContainerFactory jmsListenerContainerFactory() {
        DefaultJmsListenerContainerFactory factory = new DefaultJmsListenerContainerFactory();
        factory.setPubSubDomain(true); // Enable topic support
        factory.setConnectionFactory(connectionFactory());
        return factory;
    }

    @Bean
    public ActiveMQConnectionFactory connectionFactory() {
        ActiveMQConnectionFactory factory = new ActiveMQConnectionFactory("tcp://localhost:61616", "admin", "admin");
        factory.setCallTimeout(30000);  // 30 seconds for method calls
        factory.setReconnectAttempts(5); // Infinite reconnect attempts
        return factory;
    }

}


/*
*
* @JmsListener(destination = "JmsTopic", containerFactory = "jmsListenerContainerFactory", id = "2")
	public void processToDo(String message) {
		System.out.println(message);
	}
* */