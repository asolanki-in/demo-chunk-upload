package com.example.Publisher;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jms.annotation.EnableJms;
import org.springframework.jms.core.JmsTemplate;
import org.springframework.stereotype.Component;

@Component
@EnableJms
public class ArtemisProducer {

    @Autowired
    JmsTemplate jmsTemplate;

    public void send(String msg){
        jmsTemplate.convertAndSend("JmsTopic", msg);
    }
}
